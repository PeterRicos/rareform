/* Headless size-search harness for app.js (same folder)
   Run: node test-size-search.js   (or: node randomstock/test-size-search.js)
   Boots products.js + app.js inside the same stub DOM as test-route.js and
   validates the size-search contract:
     - "11" shows products held in 11 AND 11.5 (same men's run, never 11W/11K)
     - "11.5" / "11W" / "m" match only that exact size
     - model numbers ("700") stay keyword searches
     - the header search modal follows the same rule as the shop filter search
     - a listing whose sizes can't say which run they belong to declares it
       (`sizeGroup`), so a fitted cap holding 7 next to 7 1/8 reads as headwear
       instead of "Mixed sizing" with a "US 7" in its order sentence */

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
    get href() { return 'file:///app/randomstock/index.html' + stack[idx].hash; }
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

  // The reveal is the one thing the page script needs that Node cannot supply (makeObserver).
  const Observer = makeObserver();

  const ctx = vm.createContext({ window: win, document: doc, history, location, setTimeout, clearTimeout, console, IntersectionObserver: Observer });
  new vm.Script(CODE, { filename: 'randomstock-inline.js' }).runInContext(ctx);

  return { win, doc, history, location, pages, getEl, listeners, ctx, Observer };
}

// Card ids in render order — every card button carries data-act="openProduct" data-arg="<id>".
const cardIds = (html) => {
  const out = [];
  String(html).replace(/data-arg=\"(\d+)\"/g, (_, id) => { if (out.indexOf(Number(id)) < 0) out.push(Number(id)); return _; });
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

  // ---- F. a listing declares the run its size strings can't say ---------------
  // The fitted cap holds 7, 7 1/8 and 7 1/2. The two fractions read as hat sizes on
  // their own, but a bare "7" is a men's shoe size in this catalog, so the listing
  // spans two runs unless it says otherwise: the detail page called it "Mixed
  // sizing" and the order sentence offered "size US 7" for a hat.
  const cap = ev(H, 'window.localProducts.find(p => p.id === 85)');
  ok('F1  the fitted cap declares its run', !!cap && cap.sizeGroup === 'Headwear', cap && cap.sizeGroup);
  ok('F2  a declared run wins over the string',
    ev(H, "sizeCategory('7', 'Headwear')") === 'Headwear' && ev(H, "sizeCategory('7')") === 'Men',
    ev(H, "sizeCategory('7', 'Headwear')"));
  ok('F3  its order sentence names a hat size, not a shoe size',
    ev(H, "sizeDisplay('7', 'Headwear')") === '7' && ev(H, "sizeDisplay('7')") === 'US 7',
    ev(H, "sizeDisplay('7', 'Headwear')"));
  ok('F4  its detail page reads Headwear sizing',
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 85))') === 'Headwear sizing',
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 85))'));

  // The label exists to describe the listing, so no listing may claim to span runs
  // when it holds one: that is what a missing sizeGroup looks like from the outside.
  const mixed = ev(H, 'window.localProducts.filter(p => sizeCategoryLabel(p) === "Mixed sizing").map(p => p.id)');
  ok('F5  no listing reads "Mixed sizing"', mixed.length === 0, JSON.stringify(mixed));

  // ...and the run a listing declares has to keep it reachable by that size.
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = '7 1/2'; renderShop();");
  const hatIds = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('F6  the size filter reaches the cap by its hat size', hatIds.indexOf(85) >= 0, JSON.stringify(hatIds));

  // ---- H. the size dropdown groups by the listing's run, not the string -------
  // The fitted cap's bare "7" used to land under Men as "US 7": the dropdown was
  // built from deduped size strings, so the listing's declared run never reached
  // it. Grouping by the listing instead puts the cap's 7 under Headwear as "7"
  // while the shoe held in 7 stays under Men as "US 7".
  ev(H, 'renderFilterUI();');
  const sizeHtml = String(ev(H, "document.getElementById('sizeFilter').innerHTML"));
  const groupOf = (html, label) => {
    const m = html.match(new RegExp('<optgroup label="' + label + '">([\\s\\S]*?)</optgroup>'));
    return m ? m[1] : '';
  };
  ok('H1  the cap\'s bare 7 is a Headwear option, not a men\'s shoe size',
    /<option value="7">7<\/option>/.test(groupOf(sizeHtml, 'Headwear')), groupOf(sizeHtml, 'Headwear'));
  ok('H2  the shoe held in 7 still reads as a men\'s size',
    /<option value="7">US 7<\/option>/.test(groupOf(sizeHtml, 'Men')), groupOf(sizeHtml, 'Men'));


  // ---- G. what the cards SHOW under a size search -----------------------------
  // Filtering correctly is only half of it. A card that answers "11" but prints the
  // pair's whole run under the photo — "US 7.5 · 8 · 9 · 11" on a Jordan 11 — still
  // reads as a broken search, because the sizes a shopper can see are not the sizes
  // they asked for. Under a size query the card prints the sizes that answered it.
  const sizeLinesIn = (html) => String(html).match(/<div class="sizes[^"]*">([^<]*)<\/div>/g) || [];
  const numbersIn = (text) => String(text).match(/\d+(?:\.\d+)?/g) || [];
  const cardBlock = (html, id) => {
    const i = String(html).indexOf('data-arg="' + id + '"');
    if (i < 0) return '';
    const j = String(html).indexOf('<div class="price-note"', i);
    return String(html).slice(i, j < 0 ? i + 1600 : j);
  };

  ev(H, "document.getElementById('sizeFilter').value = ''; document.getElementById('filterSearch').value = '11'; renderShop();");
  const grid11 = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const lines11 = sizeLinesIn(grid11).map((block) => numbersIn(block));
  ok('G1  under "11" every card prints 11 and/or 11.5 and nothing else',
    lines11.length > 0 && lines11.every((n) => n.length > 0 && n.every((v) => v === '11' || v === '11.5')),
    JSON.stringify(sizeLinesIn(grid11)));

  ok('G2  the shop count names the sizes on screen',
    /ITEMS IN US 11 \/ 11\.5/.test(String(ev(H, "document.getElementById('productTotal').textContent"))),
    String(ev(H, "document.getElementById('productTotal').textContent")));

  // The case that started this: a pair held in 11 next to smaller sizes must show the
  // 11 beside its photo, not the 7.5 it is also held in.
  const runsOf = (p) => (p.sizes || []);
  const jordan11 = catalog.find((p) => runsOf(p).indexOf('11') >= 0 && runsOf(p).length > 2)
    || catalog.find((p) => runsOf(p).indexOf('11') >= 0);
  ok('G3  the catalog still holds a pair with 11 in a longer run', !!jordan11 && runsOf(jordan11).length > 2,
    jordan11 && JSON.stringify(runsOf(jordan11)));
  const oneLine = (cardBlock(grid11, jordan11.id).match(/<div class="sizes[^"]*">([^<]*)</) || [])[1] || '';
  ok('G4  that pair\'s card shows only the 11, not the rest of its run',
    numbersIn(oneLine).length > 0 && numbersIn(oneLine).every((v) => v === '11' || v === '11.5')
      && numbersIn(oneLine).length < runsOf(jordan11).length,
    oneLine + '  (run: ' + JSON.stringify(runsOf(jordan11)) + ')');

  // The same rule for a letter: "m" is a size, so a clothing card has to be able to say
  // which size answered — it printed no size line at all before, having none to print.
  ev(H, "document.getElementById('filterSearch').value = 'm'; renderShop();");
  const gridM = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const mIds = cardIds(gridM);
  ok('G5  "m" reaches the clothing held in M and nothing else',
    mIds.length > 0 && mIds.every((id) => {
      const p = catalog.find((x) => x.id === id);
      return p && runsOf(p).some((s) => String(s).toLowerCase() === 'm');
    }), JSON.stringify(mIds));
  ok('G6  and those cards print the size that answered',
    /<div class="sizes sizes-match">M<\/div>/.test(gridM)
      && sizeLinesIn(gridM).every((block) => /^M$/.test(block.replace(/<[^>]+>/g, '').trim().replace(/<\/div>$/, '').trim())),
    JSON.stringify(sizeLinesIn(gridM)));

  // A listing opened from the search opens on the size that was searched and says so:
  // the order sentence should name the 11 the shopper asked for, not the run's first size.
  ev(H, "document.getElementById('filterSearch').value = '11'; renderShop();");
  ev(H, 'renderProduct(' + jordan11.id + ')');
  const details = String(ev(H, "document.getElementById('details').innerHTML"));
  ok('G7  a listing opened from the search starts on the searched size',
    /<button class="size-btn selected is-match"/.test(details),
    (details.match(/<button class="size-btn[^"]*"/g) || []).join(' '));
  ok('G8  and it marks the sizes that answered, in a note that names them',
    /class="size-match-note">This pair is held in the sizes your search asked for: US 11\.</.test(details),
    (details.match(/class="size-match-note">[^<]*/) || ['no note'])[0]);

  // A listing opened with no size search reads exactly as it did: first size selected,
  // whole run shown, no note.
  ev(H, "document.getElementById('filterSearch').value = ''; renderShop();");
  ev(H, 'renderProduct(' + jordan11.id + ')');
  const plain = String(ev(H, "document.getElementById('details').innerHTML"));
  ok('G9  without a size search the listing is unchanged',
    !/is-match/.test(plain) && !/size-match-note/.test(plain)
      && /<button class="size-btn selected"/.test(plain),
    (plain.match(/<button class="size-btn[^"]*"/g) || []).join(' '));

  // ...and the size dropdown asks the same question, so the cards answer it the same way.
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = '11'; renderShop();");
  const gridDrop = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const dropLines = sizeLinesIn(gridDrop).map((block) => numbersIn(block));
  ok('G10 the size dropdown narrows the printed sizes too',
    dropLines.length > 0 && dropLines.every((n) => n.length > 0 && n.every((v) => v === '11' || v === '11.5')),
    JSON.stringify(sizeLinesIn(gridDrop)));
  ev(H, "document.getElementById('sizeFilter').value = '';");

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
