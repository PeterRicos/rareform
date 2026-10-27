/* Headless router harness for index.html (same folder)
   Run: node test-route.js        (or: node randomstock/test-route.js)
   Boots the page script inside a stub DOM and validates the hash router:
   canonical URLs, refresh/deep-link hydration, back/forward, section anchors,
   URL canonicalisation and anchor click interception.                        */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The live page loads products.js (catalog) then app.js (logic) — index.html no
// longer carries a script body — so the harness evaluates those two in order.
const CODE = fs.readFileSync(path.join(__dirname, 'products.js'), 'utf8') + '\n' +
             fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

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

// app.js reveals each product as it scrolls into view, through an IntersectionObserver that
// Node does not have — without one the page script dies the moment it draws the home grid,
// which is how this harness stopped running. The stub never fires by itself (the stub DOM
// draws no .product cards to watch): enter(el) plays the entry a browser would hand over for
// an element that has just come on screen, and observed() reports what app.js asked to watch.
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
  Observer.observed = () => instances.reduce((acc, o) => acc.concat(o.targets), []);
  Observer.count = () => instances.length;
  return Observer;
}

// cfg.opaque === true simulates a file:// document, where pushState(url) throws.
function boot(initialHash, cfg) {
  cfg = cfg || {};
  const PAGE_IDS = ['home', 'shop', 'product', 'about'];
  const pages = {};
  // The live markup gives each view container id="view-<name>" plus data-view="<name>".
  // An element whose id equals the hash is a browser fragment target, which scrolled
  // the announcement bar and nav off-screen on every fresh #home/#shop/#about load.
  // Mirror that shape here so the harness exercises the same contract.
  PAGE_IDS.forEach((id) => {
    pages[id] = makeEl('view-' + id);
    pages[id].dataset.view = id;
  });
  pages.home._classes.add('active');

  const els = new Map(PAGE_IDS.map((id) => ['view-' + id, pages[id]]));
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

  // The grids are drawn as markup, so a stub DOM has no elements to hand back for '.product'.
  // It returns this fixed trio instead: the page script cannot tell them from real cards, and
  // a test can watch the scroll reveal take them (see makeObserver, Observer.enter).
  const cards = [makeEl('card-1'), makeEl('card-2'), makeEl('card-3')];

  const listeners = { window: {}, document: {} };
  const addL = (target, t, fn) => { (listeners[target][t] = listeners[target][t] || []).push(fn); };
  const fire = (target, t, ev) => (listeners[target][t] || []).forEach((fn) => fn(ev));
  const queueFire = (target, t, ev) => setTimeout(() => fire(target, t, ev), 0);

  const doc = {
    title: '',
    body: makeEl('body'),
    getElementById: getEl,
    querySelectorAll: (sel) => (sel === '.page' ? PAGE_IDS.map((id) => pages[id])
      : (sel === '.product' ? cards : [])),
    querySelector: (sel) => (sel === '.page.active'
      ? PAGE_IDS.map((id) => pages[id]).find((p) => p._classes.has('active')) || null
      : null),
    addEventListener: (t, fn) => addL('document', t, fn)
  };

  // ---- history / location -------------------------------------------------
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
    get href() { return 'file:///app/randomstock/index.html' + stack[idx].hash; }
  };
  const history = {
    scrollRestoration: 'auto',
    get state() { return stack[idx].state; },
    pushState(state, title, url) {
      if (cfg.opaque && url) { const e = new Error('SecurityError'); e.name = 'SecurityError'; throw e; }
      stack = stack.slice(0, idx + 1);
      stack.push({ state, hash: hashOf(url) });
      idx = stack.length - 1;
    },
    replaceState(state, title, url) {
      if (cfg.opaque && url && hashOf(url) !== stack[idx].hash) {
        const e = new Error('SecurityError'); e.name = 'SecurityError'; throw e;
      }
      stack[idx] = { state, hash: hashOf(url) };
    },
    back() {
      if (idx === 0) return;
      idx -= 1;
      const ev = { state: stack[idx].state };
      queueFire('window', 'popstate', ev);
      queueFire('window', 'hashchange', {});
    },
    get length() { return stack.length; }
  };

  const scrollCalls = [];
  const win = {
    scrollY: 0,
    scrollTo(opts) {
      const top = (opts && typeof opts === 'object') ? opts.top : opts;
      scrollCalls.push(top || 0);
      win.scrollY = top || 0;
    },
    addEventListener: (t, fn) => addL('window', t, fn),
    document: doc, history, location
  };

  // The reveal is the one thing the page script needs that Node cannot supply (makeObserver).
  const Observer = makeObserver();

  const ctx = vm.createContext({ window: win, document: doc, history, location, setTimeout, clearTimeout, console, IntersectionObserver: Observer });
  new vm.Script(CODE, { filename: 'randomstock-inline.js' }).runInContext(ctx);

  // Report the view key (data-view), not the DOM id — assertions compare against
  // 'home' / 'shop' / 'product' / 'about'.
  const activeView = () => {
    const el = doc.querySelector('.page.active');
    return (el && el.dataset.view) || '';
  };

  return { win, doc, history, location, pages, getEl, cards, listeners, fire, queueFire, scrollCalls, ctx, active: activeView, activeId: () => (doc.querySelector('.page.active') || {}).id, Observer };
}

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);

  // ---- A. cold load without a hash -----------------------------------------
  const A = boot('');
  await sleep(320);
  ok('A1  hash normalised to #home', A.location.hash === '#home', A.location.hash);
  ok('A2  home page active', A.active() === 'home', A.active());
  ok('A3  default title', A.doc.title === 'Random Stock — Hand-Checked Sneakers', A.doc.title);
  // The sheet draws a card invisible (opacity: 0) until something adds .reveal, so a view
  // that never hands its grid to an observer draws a blank page. A stub DOM would not notice
  // that on its own — it is the one place this used to be hidden, by dying on the call.
  ok('A4  every card the home grid draws is handed to the scroll reveal',
    A.cards.length > 0 && A.cards.every((c) => A.Observer.observed().indexOf(c) >= 0),
    'cards=' + A.cards.length + ' watched=' + A.Observer.observed().length);
  A.Observer.enter(A.cards[0]);
  await sleep(160);
  ok('A5  an entry on screen reveals that card and stops watching it',
    A.cards[0]._classes.has('reveal') && A.Observer.observed().indexOf(A.cards[0]) < 0,
    Array.from(A.cards[0]._classes).join(',') || '(no classes)');

  // ---- B. refresh on a shared product link ---------------------------------
  const B = boot('#product/3');
  await sleep(320);
  ok('B1  product page active', B.active() === 'product', B.active());
  ok('B2  product hydrated from URL', ev(B, 'current.id') === 3, ev(B, 'current.id'));
  ok('B3  detail rendered', String(B.getEl('details').innerHTML).length > 0 || String(B.getEl('gallery').innerHTML).length > 0);
  ok('B4  title follows product', /— Random Stock$/.test(B.doc.title) && B.doc.title !== 'Random Stock — Verified Sneakers & Streetwear', B.doc.title);
  ok('B5  url untouched', B.location.hash === '#product/3', B.location.hash);

  // ---- C. deep link to a home section --------------------------------------
  const C = boot('#street');
  await sleep(320);
  ok('C1  home page active', C.active() === 'home', C.active());
  ok('C2  #street scrolled into view', !!C.getEl('street')._scrolled);
  ok('C3  url kept', C.location.hash === '#street', C.location.hash);

  // ---- D. deep link to about -----------------------------------------------
  const D = boot('#about');
  await sleep(320);
  ok('D1  about active', D.active() === 'about', D.active());
  ok('D2  about title', D.doc.title === 'Our Story — Random Stock', D.doc.title);

  // ---- E/F. bad or bare product ids canonicalise ----------------------------
  const E = boot('#product/999');
  await sleep(320);
  ok('E1  unknown id falls back to a real product', ev(E, 'current.id') === 1, ev(E, 'current.id'));
  ok('E2  url canonicalised', E.location.hash === '#product/1', E.location.hash);
  const F = boot('#product');
  await sleep(320);
  ok('F1  bare #product canonicalised', F.location.hash === '#product/1', F.location.hash);

  // ---- G. click-through flow + browser back --------------------------------
  const G = boot('');
  await sleep(320);
  ev(G, 'go("shop")');
  await sleep(80);
  ok('G1  shop url', G.location.hash === '#shop', G.location.hash);
  ok('G2  shop active', G.active() === 'shop', G.active());
  ev(G, 'openProduct(3)');
  await sleep(80);
  ok('G3  product url pushed', G.location.hash === '#product/3', G.location.hash);
  ok('G4  product rendered', ev(G, 'current.id') === 3);
  ok('G5  three history entries', G.history.length === 3, G.history.length);
  G.history.back();
  await sleep(320);
  ok('G6  back → shop', G.active() === 'shop' && G.location.hash === '#shop', G.active() + ' ' + G.location.hash);
  G.history.back();
  await sleep(320);
  ok('G7  back → home', G.active() === 'home' && G.location.hash === '#home', G.active() + ' ' + G.location.hash);

  // ---- G8: the shop grid is built when the shop is shown ---------------------
  // Boot used to render all 102 cards for every visitor, including the ones who only ever
  // looked at the hero or a shared pair link. The grid now mounts on first arrival at the
  // view, so boot has to leave it empty and going to the shop has to fill it — one without
  // the other means the deferral either did nothing or broke the shop.
  const Q = boot('');
  await sleep(320);
  const beforeShop = String(Q.getEl('shopProducts').innerHTML || '');
  ev(Q, 'go("shop")');
  await sleep(80);
  const afterShop = String(Q.getEl('shopProducts').innerHTML || '');
  ok('G8  the shop grid is built when the shop is shown, not at boot',
    beforeShop === '' && afterShop.indexOf('class="product"') >= 0,
    'at boot=' + beforeShop.length + ' chars, at #shop=' + afterShop.length + ' chars');
  // ---- H. section nav is shareable and reversible ---------------------------
  // (the old '#heat' section and its scrollToSection() helper were removed from
  // the site, so this exercises today's flow: a section hash on the home route)
  const P = boot('');
  await sleep(320);
  P.location.hash = '#street';
  await sleep(320);
  ok('H1  url #street', P.location.hash === '#street', P.location.hash);
  ok('H2  home stays active', P.active() === 'home', P.active());
  ok('H3  #street scrolled', !!P.getEl('street')._scrolled);
  P.history.back();
  await sleep(400);
  ok('H4  back → #home', P.location.hash === '#home', P.location.hash);

  // ---- I. manual hash edit (hashchange route) -------------------------------
  const I = boot('');
  await sleep(320);
  I.location.hash = '#shop';
  await sleep(320);
  ok('I1  manual hash routes', I.active() === 'shop', I.active());

  // ---- J. scroll offset stored in the entry, url untouched -----------------
  const J = boot('#shop');
  await sleep(320);
  J.win.scrollY = 640;
  J.fire('window', 'scroll', {});
  await sleep(220);
  ok('J1  scrolling keeps the url', J.location.hash === '#shop', J.location.hash);
  ok('J2  scroll offset stored in state', !!J.history.state && J.history.state.y === 640, JSON.stringify(J.history.state));
  // The shop draws the same cards as home and they are invisible until the reveal takes them,
  // so the shop view has to wire it too — one renderer is not the other.
  ok('J3  the shop grid hands its cards to the scroll reveal as well',
    J.cards.every((c) => J.Observer.observed().indexOf(c) >= 0),
    'watched=' + J.Observer.observed().length);

  // ---- K. file:// fallback where pushState(url) throws ---------------------
  const K = boot('', { opaque: true });
  await sleep(320);
  ok('K1  home normalised via hash fallback', K.location.hash === '#home', K.location.hash);
  ev(K, 'openProduct(4)');
  await sleep(320);
  ok('K2  product url via hash fallback', K.location.hash === '#product/4', K.location.hash);
  ok('K3  product rendered once', K.active() === 'product' && ev(K, 'current.id') === 4, K.active() + ' ' + ev(K, 'current.id'));

  // ---- L. anchor click interception -----------------------------------------
  const L = boot('');
  await sleep(320);
  let prevented = 0;
  const evt = (anchor) => ({ target: { closest: () => anchor }, preventDefault: () => { prevented += 1; } });
  L.fire('document', 'click', evt({ hasAttribute: (n) => n === 'data-act', getAttribute: () => '#shop' }));
  ok('L1  handler-wired anchor prevented', prevented === 1, prevented);
  L.fire('document', 'click', evt({ hasAttribute: () => false, getAttribute: () => '#shop' }));
  ok('L2  plain anchor left to hashchange', prevented === 1, prevented);
  L.fire('document', 'click', evt(null));
  ok('L3  non-anchor click ignored', prevented === 1, prevented);

  // ---- M. url ↔ route round trip -------------------------------------------
  const M = boot('');
  await sleep(320);
  const table = [
    ['#home', 'home', null, null, '#home'],
    ['#shop', 'shop', null, null, '#shop'],
    ['#about', 'about', null, null, '#about'],
    ['#product/3', 'product', 3, null, '#product/3'],
    ['#product', 'product', null, null, '#product'],
    ['#street', 'home', null, 'street', '#street'],
    ['#heat', 'home', null, 'heat', '#heat'],
    ['', 'home', null, null, '#home'],
    ['#bogus', 'home', null, 'bogus', '#bogus']
  ];
  table.forEach((row) => {
    const hash = row[0], page = row[1], pid = row[2], section = row[3], canon = row[4];
    const r = ev(M, 'parseHash(' + JSON.stringify(hash) + ')');
    const u = ev(M, 'hashURL(' + JSON.stringify(r.page) + ',' + JSON.stringify(r.pid) + ',' + JSON.stringify(r.section) + ')');
    const pass = r.page === page && r.pid === pid && r.section === section && u === canon;
    ok('M   ' + (hash || '(empty)') + ' → ' + canon, pass, JSON.stringify(r) + ' url=' + u);
  });

  // ---- N. nav: only one shop category is ever current -----------------------
  // All three category links share href="#shop", so syncRouteUI used to match on
  // the href alone and light all three at once on the Shop and Product views,
  // with aria-current="page" on each. The category is what distinguishes them:
  // the active filter on Shop, the listing's own category on Product, and none
  // at all when no filter is set. The stub DOM hands back no nav links, so this
  // section gives it the three live links, with real attributes to read.
  const N = boot('');
  await sleep(320);
  const makeNavLink = (arg) => {
    const classes = new Set();
    const attrs = { href: '#shop', 'data-act': 'shopCategory', 'data-arg': arg };
    return {
      getAttribute: (n) => (n in attrs ? attrs[n] : null),
      setAttribute: (n, v) => { attrs[n] = v; },
      removeAttribute: (n) => { delete attrs[n]; },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }
      },
      _classes: classes, _attrs: attrs
    };
  };
  const navLinks = ['sneakers', 'clothing', 'random'].map(makeNavLink);
  const navAbout = makeNavLink(null);
  navAbout._attrs.href = '#about';
  delete navAbout._attrs['data-act'];
  delete navAbout._attrs['data-arg'];
  navLinks.push(navAbout);
  const origQSA = N.doc.querySelectorAll;
  N.doc.querySelectorAll = (sel) => (sel === '.nav-links a' ? navLinks : origQSA(sel));
  const activeNav = () => navLinks.filter((l) => l._classes.has('active')).map((l) => l._attrs['data-arg'] || 'about');
  const currentNav = () => navLinks.filter((l) => l._attrs['aria-current'] === 'page').map((l) => l._attrs['data-arg'] || 'about');
  ev(N, 'shopCategory("clothing")');
  ok('N1  on Shop (clothing filter) only the clothing link is current',
    JSON.stringify(activeNav()) === JSON.stringify(['clothing']) && JSON.stringify(currentNav()) === JSON.stringify(['clothing']),
    'active=' + JSON.stringify(activeNav()) + ' current=' + JSON.stringify(currentNav()));
  ev(N, 'shopCategory("sneakers")');
  ok('N2  switching the filter moves the current link, it does not add one',
    JSON.stringify(activeNav()) === JSON.stringify(['sneakers']), JSON.stringify(activeNav()));
  ev(N, 'openProduct(82)');
  ok('N3  on a Random product only the Random link is current',
    JSON.stringify(activeNav()) === JSON.stringify(['random']), JSON.stringify(activeNav()));
  ev(N, 'openProduct(3)');
  ok('N4  on a sneaker product only the Sneakers link is current',
    JSON.stringify(activeNav()) === JSON.stringify(['sneakers']), JSON.stringify(activeNav()));
  ev(N, 'resetFilters(); go("shop");');
  ok('N5  on the unfiltered vault no category link claims to be current',
    activeNav().length === 0 && currentNav().length === 0, JSON.stringify(activeNav()));

  // ---- O. shortlist: stars, localStorage, one text for several pairs ---------
  // There is no cart and prices are settled by text, so friends asking about
  // two or three pairs at once need a shortlist, not a checkout. A star on a
  // card saves the listing id under randomstock.saved (the Recently Viewed
  // pattern), and the saved panel's text link names every saved item with its
  // SKU and held sizes. The stub DOM has no localStorage, so this section
  // hands the harness a small in-memory one first — without it, the save
  // would silently not persist, which is exactly the failure to catch.
  const O = boot('');
  await sleep(320);
  O.ctx.localStorage = {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); }
  };
  const card50 = ev(O, 'productCard(products.find(p => p.id === 50))');
  ok('O1  a card carries a save star for its listing, unpressed at first',
    /class="save-btn"/.test(card50) && /data-act="toggleSave" data-arg="50"/.test(card50)
      && /aria-pressed="false"/.test(card50) && card50.indexOf('☆') >= 0,
    card50.replace(/\s+/g, ' ').slice(0, 200));
  ev(O, 'toggleSave(50); toggleSave(17);');
  const msg = ev(O, 'savedMessage()');
  ok('O2  two saved pairs make one message naming both, with SKU and sizes',
    msg.indexOf('Travis Scott') >= 0 && msg.indexOf('Wave Runner') >= 0
      && msg.indexOf('SKU') >= 0 && msg.indexOf('still available') >= 0,
    msg);
  const card50Saved = ev(O, 'productCard(products.find(p => p.id === 50))');
  ok('O3  a saved card re-renders pressed, with a filled star',
    /class="save-btn is-saved"/.test(card50Saved) && /aria-pressed="true"/.test(card50Saved)
      && card50Saved.indexOf('★') >= 0,
    card50Saved.replace(/\s+/g, ' ').slice(0, 200));
  ev(O, 'toggleSave(50);');
  ok('O4  toggling again removes the pair, leaving only the other',
    ev(O, 'savedMessage()').indexOf('Travis Scott') < 0
      && ev(O, 'savedMessage()').indexOf('Wave Runner') >= 0,
    ev(O, 'savedMessage()'));
  O.ctx.localStorage.setItem('randomstock.saved', JSON.stringify([17, 9999]));
  ok('O5  a stale id (pair removed from the catalog) drops out, not a crash',
    ev(O, 'savedMessage()').indexOf('Wave Runner') >= 0
      && ev(O, 'savedMessage()').indexOf('undefined') < 0,
    ev(O, 'savedMessage()'));

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
