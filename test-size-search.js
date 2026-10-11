/* Headless size-search harness for app.js (same folder)
   Run: node test-size-search.js   (or: node rareform/test-size-search.js)
   Boots products.js + app.js inside the same stub DOM as test-route.js and
   validates the size-search contract:
     - "11" shows products held in 11 AND 11.5 (same men's run, never 11W/11K)
     - "11.5" / "11W" / "m" match only that exact size
     - model numbers ("700") stay keyword searches
     - the header search modal follows the same rule as the shop filter search */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

  const ctx = vm.createContext({ window: win, document: doc, history, location, setTimeout, clearTimeout, console });
  new vm.Script(CODE, { filename: 'rareform-inline.js' }).runInContext(ctx);

  return { win, doc, history, location, pages, getEl, listeners, ctx };
}

// Card ids in render order — every card button carries openProduct(<id>).
const cardIds = (html) => {
  const out = [];
  String(html).replace(/openProduct\((\d+)\)/g, (_, id) => { if (out.indexOf(Number(id)) < 0) out.push(Number(id)); return _; });
  return out;
};

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);
  const H = boot('');
  await sleep(320);

  // ---- A. parseSizeQuery: numbers are sizes, model numbers are not ------------
  const A = [
    ['11',        { value: 11,   suffix: '', letters: false, display: 'US 11 / 11.5' }],
    ['11.5',      { value: 11.5, suffix: '', letters: false, display: 'US 11.5' }],
    ['size 11',   { value: 11,   suffix: '', letters: false, display: 'US 11 / 11.5' }],
    ['US 11',     { value: 11,   suffix: '', letters: false, display: 'US 11 / 11.5' }],
    ['5.5w',      { value: 5.5,  suffix: 'w', letters: false, display: 'US 5.5' }],
    ['m',         { value: 'm',  suffix: '', letters: true,  display: 'Size M' }]
  ];
  A.forEach(([input, want]) => {
    const got = ev(H, 'parseSizeQuery(' + JSON.stringify(input) + ')');
    const pass = got && Object.keys(want).every((k) => got[k] === want[k]);
    ok('A   parse "' + input + '"', pass, JSON.stringify(got));
  });
  ok('A   parse "700" stays a keyword', ev(H, 'parseSizeQuery("700")') === null);
  ok('A   parse "jordan" stays a keyword', ev(H, 'parseSizeQuery("jordan")') === null);

  // ---- B. matchesSize on synthetic products ----------------------------------
  const B = [
    ['11',    ['11'],    true],
    ['11',    ['11.5'],  true],
    ['11',    ['11W'],   false],
    ['11',    ['11K'],   false],
    ['11',    ['10.5'],  false],
    ['11.5',  ['11.5'],  true],
    ['11.5',  ['11'],    false],
    ['5.5w',  ['5.5W'],  true],
    ['5.5w',  ['5.5'],   false],
    ['5.5w',  ['6W'],    false],
    ['m',     ['M'],     true],
    ['m',     ['XL'],    false]
  ];
  B.forEach(([query, sizes, want]) => {
    ev(H, 'window.__p = ' + JSON.stringify({ sizes }) + '; window.__q = parseSizeQuery(' + JSON.stringify(query) + ');');
    const got = ev(H, 'matchesSize(window.__p, window.__q)');
    ok('B   "' + query + '" vs ' + JSON.stringify(sizes), got === want, got);
  });

  // ---- C. live catalog: "11" returns exactly the 11 / 11.5 pairs --------------
  const catalog = ev(H, 'window.localProducts');
  // Independent expectation: a whole number covers its half ("11" → 11 / 11.5),
  // a half-size query covers only itself ("11.5" → 11.5).
  const expectedFor = (query) => {
    const whole = Number(query) % 1 === 0;
    const wanted = whole ? ['' + query, (+query + 0.5) + ''] : ['' + query];
    return catalog.filter((p) =>
      (p.sizes || []).some((s) => wanted.indexOf(String(s).trim()) >= 0)
    ).map((p) => p.id);
  };
  const got11 = ev(H, 'products.filter(p => matchesSize(p, parseSizeQuery("11"))).map(p => p.id)');
  ok('C1  "11" hits the catalog 11 and 11.5 pairs only', JSON.stringify(got11) === JSON.stringify(expectedFor(11)),
    'got ' + JSON.stringify(got11) + ' want ' + JSON.stringify(expectedFor(11)));
  ok('C2  "11" finds something', got11.length > 0, got11.length);

  // ---- D. shop filter search end-to-end --------------------------------------
  ev(H, "document.getElementById('mobileSearch').value = '';");
  ev(H, "document.getElementById('filterSearch').value = '11'; renderShop();");
  const shopIds = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('D1  shop "11" renders the 11 / 11.5 pairs only', JSON.stringify(shopIds) === JSON.stringify(expectedFor(11)),
    'got ' + JSON.stringify(shopIds) + ' want ' + JSON.stringify(expectedFor(11)));

  ev(H, "document.getElementById('filterSearch').value = '11.5'; renderShop();");
  const shopIds115 = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('D2  shop "11.5" renders only the 11.5 pairs', JSON.stringify(shopIds115) === JSON.stringify(expectedFor(11.5)),
    'got ' + JSON.stringify(shopIds115));

  ev(H, "document.getElementById('filterSearch').value = '15.5'; renderShop();");
  ok('D3  shop empty state names the size', /Nothing in US 15\.5 right now/.test(String(ev(H, "document.getElementById('shopProducts').innerHTML"))));

  ev(H, "document.getElementById('filterSearch').value = '700'; renderShop();");
  const shop700 = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('D4  shop "700" still finds Yeezy 700s by keyword', shop700.length > 0 && shop700.some((id) => {
    const p = catalog.find((x) => x.id === id);
    return p && (p.brand + ' ' + p.name + ' ' + p.color).toLowerCase().includes('700');
  }), JSON.stringify(shop700));

  // ---- E. header search modal follows the same rule ---------------------------
  ev(H, "document.getElementById('globalSearch').value = '11'; globalSearch();");
  const modalIds = cardIds(ev(H, "document.getElementById('searchResults').innerHTML"));
  ok('E1  modal "11" renders only 11 / 11.5 pairs', JSON.stringify(modalIds) === JSON.stringify(expectedFor(11).slice(0, 4)),
    'got ' + JSON.stringify(modalIds) + ' want ' + JSON.stringify(expectedFor(11).slice(0, 4)));

  ev(H, "document.getElementById('globalSearch').value = '15.5'; globalSearch();");
  ok('E2  modal empty state names the size', /Nothing in US 15\.5 right now/.test(String(ev(H, "document.getElementById('searchResults').innerHTML"))));

  ev(H, "document.getElementById('globalSearch').value = 'yeezy'; globalSearch();");
  const yeezyIds = cardIds(ev(H, "document.getElementById('searchResults').innerHTML"));
  ok('E3  modal keyword search still works', yeezyIds.length > 0 && yeezyIds.every((id) => {
    const p = catalog.find((x) => x.id === id);
    return p && (p.brand + ' ' + p.name).toLowerCase().includes('yeezy');
  }), JSON.stringify(yeezyIds));

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
