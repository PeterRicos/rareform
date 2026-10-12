/* Headless reveal harness for app.js + styles.css (same folder)
   Run: node test-reveal.js   (or: node rareform/test-reveal.js)

   Product cards are hidden until a scroll-reveal observer shows them, which makes
   "the grid is empty" and "no results" look identical to a shopper. That is exactly
   how a phone user searching 11 got a blank panel while the DOM held seven cards:
   .product defaulted to opacity 0 and only the cards drawn at boot were ever handed
   to the observer, so every search result and every card in the header search modal
   stayed invisible. This harness holds three things in place:

     - every function that injects .product cards calls observeProducts() again
       (the observer only watches the nodes it was given, and a re-render throws them away)
     - the hidden state is armed by that function, so a render path that never reaches
       it — or a browser with no IntersectionObserver — draws cards instead of hiding them
     - a card already scrolled past is revealed at once, because it will never intersect

   It also pins the CSS contract that keeps the hover lift working on a revealed card. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const CODE = fs.readFileSync(path.join(__dirname, 'products.js'), 'utf8') + '\n' + APP;

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeEl(id) {
  const classes = new Set();
  const el = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, _classes: classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (on) classes.add(c); else classes.delete(c);
      }
    },
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    focus: () => {},
    reset: () => {},
    appendChild: () => {},
    closest: (sel) => el,
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollIntoView: (opts) => { el._scrolled = opts || true; }
  };
  return el;
}

// Fake product card. `bottom` is its distance from the top of the viewport, which is all
// app.js reads to tell "still below the reader" from "already scrolled past"; a card drawn
// while its view is hidden has no layout at all, so it arrives as height 0.
function makeCard(bottom, height) {
  const h = height === undefined ? 120 : height;
  const el = makeEl('card');
  el.getBoundingClientRect = () => ({ top: bottom - h, bottom, left: 0, right: 300, width: 300, height: h });
  return el;
}

function makeObserver() {
  const instances = [];
  function Observer(cb) {
    this.cb = cb;
    this.targets = [];
    instances.push(this);
    this.observe = (el) => { if (this.targets.indexOf(el) < 0) this.targets.push(el); };
    this.unobserve = (el) => { const i = this.targets.indexOf(el); if (i >= 0) this.targets.splice(i, 1); };
    this.disconnect = () => { this.targets = []; };
    this.takeRecords = () => [];
  }
  Observer.enter = (el) => instances.slice().forEach((o) => o.cb(
    [{ isIntersecting: true, target: el, intersectionRatio: 1 }], o));
  // A real delivery is a batch, not one card, so a check needs to be able to send one.
  Observer.deliver = (entries) => instances.slice().forEach((o) => o.cb(entries, o));
  Observer.observed = () => instances.reduce((acc, o) => acc.concat(o.targets), []);
  Observer.count = () => instances.length;
  // observed() hands back a copy, so a test that wants to look at one render in isolation
  // clears the watch list through here.
  Observer.reset = () => instances.forEach((o) => { o.targets = []; });
  return Observer;
}

function boot(initialHash) {
  const PAGE_IDS = ['home', 'shop', 'product', 'about'];
  const pages = {};
  PAGE_IDS.forEach((id) => {
    pages[id] = makeEl('view-' + id);
    pages[id].dataset.view = id;
  });
  pages.home._classes.add('active');

  const els = new Map(PAGE_IDS.map((id) => ['view-' + id, pages[id]]));
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

  const listeners = { window: {}, document: {} };
  const addL = (target, t, fn) => (listeners[target][t] = listeners[target][t] || []).push(fn);
  const queueFire = (target, t, ev) => setTimeout(() => (listeners[target][t] || []).forEach((fn) => fn(ev)), 0);

  const doc = {
    title: '',
    body: makeEl('body'),
    getElementById: getEl,
    querySelectorAll: (sel) => (sel === '.page' ? PAGE_IDS.map((id) => pages[id]) : []),
    querySelector: (sel) => (sel === '.page.active'
      ? PAGE_IDS.map((id) => pages[id]).find((p) => p._classes.has('active')) || null
      : null),
    addEventListener: (t, fn) => addL('document', t, fn)
  };

  let stack = [{ state: null, hash: initialHash || '' }];
  let idx = 0;
  const hashOf = (url) => {
    if (url == null || url === '') return stack[idx].hash;
    const i = String(url).indexOf('#');
    return i < 0 ? '' : String(url).slice(i);
  };
  const location = {
    get hash() { return stack[idx].hash; },
    set hash(v) {
      const t = v && v.charAt(0) === '#' ? v : (v ? '#' + v : '');
      if (stack[idx].hash === t) return;
      stack.push({ state: null, hash: t });
      idx = stack.length - 1;
      queueFire('window', 'hashchange', {});
    },
    get href() { return 'file:///app/rareform/index.html' + stack[idx].hash; }
  };
  const history = {
    scrollRestoration: 'auto',
    get state() { return stack[idx].state; },
    pushState(state, title, url) {
      stack = stack.slice(0, idx + 1);
      stack.push({ state, hash: hashOf(url) });
      idx = stack.length - 1;
    },
    replaceState(state, title, url) { stack[idx] = { state, hash: hashOf(url) }; },
    back() {
      if (idx === 0) return;
      idx -= 1;
      queueFire('window', 'popstate', { state: stack[idx].state });
      queueFire('window', 'hashchange', {});
    },
    get length() { return stack.length; }
  };

  const win = {
    scrollY: 0,
    scrollTo(opts) {
      const top = (opts && typeof opts === 'object') ? opts.top : opts;
      win.scrollY = top || 0;
    },
    addEventListener: (t, fn) => addL('window', t, fn),
    document: doc, history, location
  };

  const Observer = makeObserver();
  const ctx = vm.createContext({ window: win, document: doc, history, location, setTimeout, clearTimeout, console, IntersectionObserver: Observer });
  new vm.Script(CODE, { filename: 'rareform-inline.js' }).runInContext(ctx);

  return { win, doc, history, location, pages, getEl, listeners, ctx, Observer };
}

// Brace-matched function bodies, so "does this renderer observe what it injected?" is
// asked of the function itself rather than of the file it lives in.
function functionBodies(src) {
  const out = [];
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex - 1;
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ name: m[1], body: src.slice(re.lastIndex, i) });
  }
  return out;
}

// The block that a selector opens, up to its closing brace.
function cssBlock(selector) {
  const i = CSS.indexOf(selector + ' {');
  if (i < 0) return null;
  const j = CSS.indexOf('}', i);
  return CSS.slice(i, j);
}

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);
  const H = boot('');
  await sleep(320);

  // ---- A. Every renderer that injects cards re-arms the observer --------------
  // The bug: globalSearch() wrote its shortlist into #searchResults and never called
  // observeProducts(), so the panel was blank on every search. Any future renderer
  // that forgets is caught here instead of by a shopper on a phone.
  const renderers = functionBodies(APP).filter((f) => f.body.indexOf('map(productCard)') >= 0);
  ok('A1  the scan finds the card renderers', renderers.length >= 4,
    renderers.map((f) => f.name).join(', '));
  const silent = renderers.filter((f) => f.body.indexOf('observeProducts()') < 0).map((f) => f.name);
  ok('A2  every card renderer calls observeProducts()', silent.length === 0, silent.join(', '));

  // ---- B. observeProducts() behaviour ----------------------------------------
  const armed = ev(H, "document.body.classList.contains('reveals-armed')");
  ok('B1  booting arms the hidden state', armed === true, armed);

  const baseQSA = H.doc.querySelectorAll;
  let currentCards = [];
  H.doc.querySelectorAll = (sel) => (sel === '.product' ? currentCards.slice() : baseQSA(sel));

  currentCards = [makeCard(500), makeCard(700), makeCard(900)];
  ev(H, 'observeProducts()');
  ok('B2  cards below the fold are handed to the observer',
    H.Observer.observed().length === 3, H.Observer.observed().length);

  H.Observer.enter(currentCards[0]);
  await sleep(120);
  ok('B3  a card that comes on screen reveals', currentCards[0]._classes.has('reveal'),
    JSON.stringify([...currentCards[0]._classes]));

  const past = makeCard(-40);
  currentCards = [past];
  ev(H, 'observeProducts()');
  ok('B4  a card already scrolled past reveals at once',
    past._classes.has('reveal') && H.Observer.observed().indexOf(past) < 0,
    JSON.stringify({ revealed: past._classes.has('reveal'), observed: H.Observer.observed().indexOf(past) >= 0 }));

  // The shop view is display:none while the home page is up, so every card it draws has a
  // zero-height rect. Reading that as "behind the reader" revealed the whole grid instantly
  // and threw the cascade away; those cards belong to the observer.
  const unlaid = makeCard(0, 0);
  H.Observer.reset();
  currentCards = [unlaid];
  ev(H, 'observeProducts()');
  ok('B8  a card with no layout yet is watched, not force-revealed',
    !unlaid._classes.has('reveal') && H.Observer.observed().indexOf(unlaid) >= 0,
    JSON.stringify({ revealed: unlaid._classes.has('reveal'), observed: H.Observer.observed().indexOf(unlaid) >= 0 }));
  H.Observer.reset();

  // Two calls on the same nodes must not pile up: one observer, and a card already shown
  // is not queued again.
  const c1 = makeCard(500);
  const c2 = makeCard(700);
  H.Observer.reset();
  currentCards = [c1, c2];
  ev(H, 'observeProducts()');
  const firstPass = H.Observer.observed().length;
  ev(H, 'observeProducts()');
  ok('B5  re-running it does not queue the same card twice',
    firstPass === 2 && H.Observer.observed().length === 2 && H.Observer.count() === 1,
    JSON.stringify({ firstPass, observed: H.Observer.observed().length, observers: H.Observer.count() }));

  H.Observer.enter(c1);
  await sleep(120);
  ev(H, 'observeProducts()');
  ok('B9  a card already on screen is left alone',
    c1._classes.has('reveal') && H.Observer.observed().indexOf(c1) < 0,
    JSON.stringify({ revealed: c1._classes.has('reveal'), reQueued: H.Observer.observed().indexOf(c1) >= 0 }));

  // A delivery is a batch, and a batch carries more than the cards on screen: the 85 vault
  // cards a re-render threw away ride in the same one as the four that replaced them. A
  // stagger numbered off the batch index put the live card 4.3 seconds out, which a shopper
  // reads as a blank grid. Only the cards that intersect take a turn in the cascade.
  const ghosts = [];
  for (let i = 0; i < 85; i++) ghosts.push(makeCard(2000 + i));
  const live = makeCard(300);
  H.Observer.reset();
  currentCards = ghosts.concat([live]);
  ev(H, 'observeProducts()');
  H.Observer.deliver(
    ghosts.map((g) => ({ isIntersecting: false, target: g, intersectionRatio: 0 }))
      .concat([{ isIntersecting: true, target: live, intersectionRatio: 0.5 }]));
  await sleep(150);
  ok('B10  a card is not queued behind the cards a re-render threw away',
    live._classes.has('reveal'), JSON.stringify([...live._classes]));

  // ...and the cascade itself survives: two cards on screen still come in one after the other.
  const c3 = makeCard(300);
  const c4 = makeCard(400);
  H.Observer.reset();
  currentCards = [c3, c4];
  ev(H, 'observeProducts()');
  H.Observer.deliver([{ isIntersecting: true, target: c3, intersectionRatio: 0.5 },
    { isIntersecting: true, target: c4, intersectionRatio: 0.5 }]);
  await sleep(20);
  const secondEarly = c4._classes.has('reveal');
  await sleep(400);
  ok('B11  two cards still cascade in, the second behind the first',
    c3._classes.has('reveal') && !secondEarly && c4._classes.has('reveal'),
    JSON.stringify({ first: c3._classes.has('reveal'), secondEarly, second: c4._classes.has('reveal') }));

  // A phone browser without IntersectionObserver must not throw on boot — the CSS gate
  // (C1/C2) is what keeps the cards visible there, so failing loudly would be worse.
  let threw = null;
  let observedWithout = null;
  H.Observer.reset();
  try {
    ev(H, 'delete globalThis.IntersectionObserver; delete window.IntersectionObserver;');
    currentCards = [makeCard(400)];
    ev(H, 'observeProducts()');
    observedWithout = H.Observer.observed().length;
  } catch (e) { threw = e; }
  ok('B6  no IntersectionObserver is survivable', threw === null, threw && threw.message);
  ok('B7  ...and it watches nothing rather than half-working', observedWithout === 0, observedWithout);
  H.ctx.IntersectionObserver = H.Observer;   // put it back for the renders below

  // ---- C. The CSS can't hide content on its own -------------------------------
  const bare = cssBlock('.product');
  ok('C1  a bare .product is not opacity 0', bare !== null && !/opacity:\s*0/.test(bare),
    bare);
  const gate = cssBlock('.reveals-armed .product:not(.reveal)');
  ok('C2  the hidden state needs the armed marker', gate !== null && /opacity:\s*0/.test(gate),
    gate);
  const reveal = cssBlock('.product.reveal');
  ok('C3  a revealed card is opaque', reveal !== null && /opacity:\s*1/.test(reveal), reveal);
  ok('C4  the hover lift still wins over the reveal rule',
    CSS.indexOf('.product.reveal {') >= 0 && CSS.indexOf('.product.reveal {') < CSS.indexOf('.product:hover {'),
    JSON.stringify({ reveal: CSS.indexOf('.product.reveal {'), hover: CSS.indexOf('.product:hover {') }));

  // ---- D. The two paths the phone user actually took --------------------------
  const cardIds = (html) => {
    const out = [];
    String(html).replace(/openProduct\((\d+)\)/g, (_, id) => { if (out.indexOf(Number(id)) < 0) out.push(Number(id)); return _; });
    return out;
  };

  ev(H, "document.getElementById('filterSearch').value = '11'; renderShop();");
  const shopIds = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('D1  the shop search for 11 finds the 11s and 11.5s', shopIds.length === 7, JSON.stringify(shopIds));

  // Shop grid: a fresh batch of cards has to be watched again, or the results draw blank.
  H.Observer.reset();
  currentCards = shopIds.map((_, i) => makeCard(600 + i));
  ev(H, 'observeProducts()');
  ok('D2  the re-rendered shop grid is observed again', H.Observer.observed().length === shopIds.length,
    H.Observer.observed().length);

  // Header search modal: this is the one that was never observed at all.
  H.Observer.reset();
  ev(H, "document.getElementById('globalSearch').value = '11'; globalSearch();");
  const modalIds = cardIds(ev(H, "document.getElementById('searchResults').innerHTML"));
  ok('D3  the modal shortlist for 11 is the four held pairs', modalIds.length === 4, JSON.stringify(modalIds));

  // Header search modal: this is the one that was never observed at all — the call has
  // to come from globalSearch() itself, on the nodes it just injected.
  H.Observer.reset();
  currentCards = modalIds.map((_, i) => makeCard(300 + i));
  ev(H, "document.getElementById('globalSearch').value = '11'; globalSearch();");
  ok('D4  globalSearch() re-arms the observer for its own shortlist',
    H.Observer.observed().length === modalIds.length, H.Observer.observed().length);

  // ...and it does so for any query, not just a size.
  H.Observer.reset();
  currentCards = modalIds.map((_, i) => makeCard(300 + i));
  ev(H, "document.getElementById('globalSearch').value = 'jordan'; globalSearch();");
  ok('D5  ...and for a keyword search too', H.Observer.observed().length > 0, H.Observer.observed().length);

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
