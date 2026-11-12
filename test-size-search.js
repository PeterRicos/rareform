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
    removeEventListener: () => {},
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

  // The header modal mirrors its query into both shop search boxes — one
  // search, two inputs — so the mobile box still holds "yeezy" here. A test
  // that clears the desktop box has to clear the mobile one too: the browser
  // does it through handleSearchSync, which a direct assignment bypasses, and
  // renderShop reads the desktop box falling back to the mobile one.
  ev(H, "document.getElementById('mobileSearch').value = '';");

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
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Headwear|7 1/2'; renderShop();");
  const hatIds = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('F6  the size filter reaches the cap by its hat size', hatIds.indexOf(85) >= 0, JSON.stringify(hatIds));

  // ---- H. the size dropdown groups by the listing's run, not the string -------
  // The fitted cap's bare "7" used to land under Men as "US 7": the dropdown was
  // built from deduped size strings, so the listing's declared run never reached
  // it. Grouping by the listing instead puts the cap's 7 under Headwear as "7"
  // while the shoe held in 7 stays under Men as "US 7".
  //
  // Grouping alone did not finish it: a phone's native picker flattens the
  // optgroups into one long list, so "US 6" under Men and "US 6" under Women
  // still read as the same choice twice. Every option label now carries its
  // run ("US 7 (Men)", "7 (Headwear)"), so a choice is unambiguous even with
  // no headers on screen. H1/H2 changed with the labels; the grouping they
  // pin is the same.
  ev(H, 'renderFilterUI();');
  const sizeHtml = String(ev(H, "document.getElementById('sizeFilter').innerHTML"));
  const groupOf = (html, label) => {
    const m = html.match(new RegExp('<optgroup label="' + label + '(?: \\(\\d+\\))?">([\\s\\S]*?)</optgroup>'));
    return m ? m[1] : '';
  };
  ok('H1  the cap\'s bare 7 is a Headwear option, not a men\'s shoe size',
    /<option value="Headwear\|7">7 \(Headwear\)<\/option>/.test(groupOf(sizeHtml, 'Headwear')), groupOf(sizeHtml, 'Headwear'));
  ok('H2  the shoe held in 7 still reads as a men\'s size',
    /<option value="Men\|7">US 7 \(Men\)<\/option>/.test(groupOf(sizeHtml, 'Men')), groupOf(sizeHtml, 'Men'));
  // The groups were already there; a count on each one is what makes them
  // scannable — a shopper can see which run holds anything without opening
  // five long lists.
  ok('H3  each size group carries its count',
    /<optgroup label="Men \(\d+\)">/.test(sizeHtml) && /<optgroup label="Women \(\d+\)">/.test(sizeHtml)
      && /<optgroup label="Youth \(\d+\)">/.test(sizeHtml), sizeHtml.match(/<optgroup label="[^"]*">/g));
  // ...and the label is what has to disambiguate, not the header above it: no
  // two options in the whole dropdown may read the same, so "US 6 (Men)" and
  // "US 6 (Women)" are different choices even in a flattened picker.
  const sizeLabels = (sizeHtml.match(/<option value="[^"]*">([^<]*)<\/option>/g) || [])
    .map((o) => o.replace(/<[^>]+>/g, ''));
  ok('H4  no two size options read the same — every label names its run',
    sizeLabels.length > 0 && new Set(sizeLabels).size === sizeLabels.length,
    JSON.stringify(sizeLabels.filter((l, i) => sizeLabels.indexOf(l) !== i)));

  // ---- I. picking a dropdown size filters by run as well as size --------------
  // Grouping the dropdown was only half of it: the option value was still the
  // bare size, so Headwear's 7 pulled in the men's shoe held in 7 too. The value
  // now carries the run, and the filter matches both.
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Headwear|7'; renderShop();");
  const hat7Ids = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('I1  Headwear 7 reaches the cap and nothing else', JSON.stringify(hat7Ids) === JSON.stringify([85]),
    JSON.stringify(hat7Ids));
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Men|7'; renderShop();");
  const men7Ids = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('I2  Men 7 reaches the shoe held in 7, not the cap',
    men7Ids.indexOf(85) < 0 && men7Ids.indexOf(48) >= 0, JSON.stringify(men7Ids));
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Headwear|7'; renderShop();");
  const hat7Grid = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('I3  the cap card prints its hat size, and the count reads it as one',
    /<div class="sizes[^"]*">7<\/div>/.test(hat7Grid)
      && /1 ITEMS IN 7$/.test(String(ev(H, "document.getElementById('productTotal').textContent"))),
    String(ev(H, "document.getElementById('productTotal').textContent")));
  ev(H, "document.getElementById('sizeFilter').value = '';");


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
    // The card no longer carries a price note (owner decision, Oct 29: the
    // "Price on request" box is gone from every card), so the slice ends at
    // the card's quick link instead — it still sits after the sizes line.
    const j = String(html).indexOf('<a class="quick"', i);
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
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Men|11'; renderShop();");
  const gridDrop = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const dropLines = sizeLinesIn(gridDrop).map((block) => numbersIn(block));
  ok('G10 the size dropdown narrows the printed sizes too',
    dropLines.length > 0 && dropLines.every((n) => n.length > 0 && n.every((v) => v === '11' || v === '11.5')),
    JSON.stringify(sizeLinesIn(gridDrop)));
  ev(H, "document.getElementById('sizeFilter').value = '';");

  // ---- J. a truncated size line says how many sizes it hid -------------------
  // A card prints at most four sizes, so a longer run used to end in a bare
  // '· +' that said nothing about what was hidden. The tail now counts:
  // the Jordan 11 Retro Jubilee (id 39) is held in six sizes, so its
  // unfiltered card prints the first four and then '+2 more'.
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = ''; renderShop();");
  const gridAll = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const jubilee = catalog.find((p) => p.id === 39);
  const jubileeLine = (cardBlock(gridAll, 39).match(/<div class="sizes[^"]*">([^<]*)</) || [])[1] || '';
  ok('J1  a card hiding sizes counts them, not a bare +',
    !!jubilee && jubilee.sizes.length === 6 && /\+2 more$/.test(jubileeLine.trim()),
    jubileeLine + '  (run: ' + JSON.stringify(jubilee && jubilee.sizes) + ')');
  // Under a size query nothing is hidden — shown === held — so the same card
  // prints only the sizes that answered and no '+N more' tail at all.
  ev(H, "document.getElementById('filterSearch').value = '11'; renderShop();");
  const grid11b = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  const jubileeQueryLine = (cardBlock(grid11b, 39).match(/<div class="sizes[^"]*">([^<]*)</) || [])[1] || '';
  ok('J2  under a size query the same card prints no +N more tail',
    !/more/.test(jubileeQueryLine) && numbersIn(jubileeQueryLine).every((v) => v === '11' || v === '11.5'),
    jubileeQueryLine);
  ev(H, "document.getElementById('filterSearch').value = '';");

  // ---- K. the size dropdown carries through to the listing, like the search -
  // Filtering for Men's 8 and opening a pair held in 5.5, 6 and 8 used to select
  // 5.5 — the dropdown was read by the shop grid but never by the detail page,
  // so the run's first size went into the order sentence. The Yeezy Beluga
  // Reflective (id 3) is held in exactly that run.
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('sizeFilter').value = 'Men|8'; renderShop();");
  ev(H, 'renderProduct(3)');
  const dropDetail = String(ev(H, "document.getElementById('details').innerHTML"));
  ok('K1  a listing opened from a Men 8 filter starts on 8, not the run\'s first size',
    /<button class="size-btn selected is-match"/.test(dropDetail)
      && /data-arg="8"/.test(dropDetail),
    (dropDetail.match(/<button class="size-btn[^"]*"/g) || []).join(' '));
  ok('K2  and it says so in a note naming the filtered size',
    /class="size-match-note">This pair is held in the size your filter asked for: US 8\.</.test(dropDetail),
    (dropDetail.match(/class="size-match-note">[^<]*/) || ['no note'])[0]);
  ok('K3  and the order sentence carries the filtered size, not 5.5',
    (() => { const href = String(ev(H, "document.getElementById('orderText').href")); const msg = decodeURIComponent(href); return /size US 8/.test(msg) && !/size US 5\.5/.test(msg); })(),
    String(ev(H, "document.getElementById('orderText').href")));
  // A size that is not the selected one still says it is not selected: a screen
  // reader gets the state from aria-pressed, not from the visual highlight.
  ok('K4  unselected sizes report aria-pressed false, the selected one true',
    /aria-pressed="false"/.test(dropDetail) && /aria-pressed="true"/.test(dropDetail), dropDetail.match(/aria-pressed="[^"]*"/g));
  ev(H, "document.getElementById('sizeFilter').value = '';");

  // ---- L. a listing's size category is declared, not defaulted ---------------
  // A bare number defaults to Men's in sizeCategory, so a Women's listing held
  // in a bare "6" read "US Men's sizing" — and grade-school listings read the
  // same way. Those five listings now declare their run outright.
  ok('L1  the Women\'s Jordan 1 Low reads US Women\'s sizing, not men\'s',
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 32))') === "US Women's sizing",
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 32))'));
  ok('L2  the grade-school listings read US Youth sizing',
    [33, 35, 55].every((id) => ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === ' + id + '))') === 'US Youth sizing'),
    [33, 35, 55].map((id) => ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === ' + id + '))')));
  ok('L3  the Lucky Green reads US Women\'s sizing, per its own colour tag',
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 37))') === "US Women's sizing",
    ev(H, 'sizeCategoryLabel(window.localProducts.find(p => p.id === 37))'));
  ok('L4  declaring the run keeps the listing reachable by its size',
    (() => { ev(H, "document.getElementById('sizeFilter').value = 'Women|6'; renderShop();"); return cardIds(ev(H, "document.getElementById('shopProducts').innerHTML")).indexOf(32) >= 0; })(),
    'Women 6 grid');
  ev(H, "document.getElementById('sizeFilter').value = '';");
  // A bare-number search is a men's search, so listings whose bare numbers belong
  // to Women, Youth or Headwear via `sizeGroup` must not leak into "6" or "7",
  // and must instead answer "6w", "7w", "12w", "4.5y" and "6.5y".
  const idsForQuery = (q) => ev(H, 'products.filter(p => matchesSize(p, parseSizeQuery(' + JSON.stringify(q) + '))).map(p => p.id)');
  const men6 = idsForQuery('6');
  const men7 = idsForQuery('7');
  ok('L5  bare-number searches exclude Women, Youth and Headwear sizeGroup listings',
    men6.indexOf(32) < 0 && men6.indexOf(33) < 0 && men6.indexOf(55) < 0
      && men7.indexOf(37) < 0 && men7.indexOf(85) < 0,
    '6=' + JSON.stringify(men6) + ' 7=' + JSON.stringify(men7));
  const w6 = idsForQuery('6w');
  const w7 = idsForQuery('7w');
  const w12 = idsForQuery('12w');
  ok('L6  "6w", "7w" and "12w" reach the Women sizeGroup listings',
    w6.indexOf(32) >= 0 && w7.indexOf(37) >= 0 && w12.indexOf(37) >= 0,
    '6w=' + JSON.stringify(w6) + ' 7w=' + JSON.stringify(w7) + ' 12w=' + JSON.stringify(w12));
  const y45 = idsForQuery('4.5y');
  const y65 = idsForQuery('6.5y');
  ok('L7  "4.5y" and "6.5y" reach the Youth sizeGroup listings',
    y45.indexOf(33) >= 0 && y45.indexOf(35) >= 0 && y65.indexOf(33) >= 0 && y65.indexOf(55) >= 0,
    '4.5y=' + JSON.stringify(y45) + ' 6.5y=' + JSON.stringify(y65));
  ev(H, "document.getElementById('filterSearch').value = '12w'; renderShop();");
  ev(H, 'renderProduct(37)');
  const luckyDetail = String(ev(H, "document.getElementById('details').innerHTML"));
  ok('L8  matchingSizes preserves sizeGroup so a "12w" search selects 12 on listing 37',
    JSON.stringify(ev(H, 'matchingSizes(window.localProducts.find(p => p.id === 37), parseSizeQuery("12w"))')) === JSON.stringify(['12'])
      && /<button class="size-btn selected is-match"[^>]*data-arg="12"/.test(luckyDetail),
    luckyDetail.slice(0, 400));
  ev(H, "document.getElementById('filterSearch').value = ''; renderShop();");

  // ---- M. the site-wide search shows a way to the rest -----------------------
  // The modal caps at four cards. Without a way out, a search answering twenty
  // pairs read as if it had answered four.
  ev(H, "document.getElementById('globalSearch').value = 'jordan'; globalSearch();");
  const modalJordan = String(ev(H, "document.getElementById('searchResults').innerHTML"));
  const jordanTotal = catalog.filter((p) =>
    (p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.sku).toLowerCase().includes('jordan')).length;
  ok('M1  a search with more than four matches offers to see all of them',
    jordanTotal > 4 && new RegExp('See all ' + jordanTotal + ' results').test(modalJordan), modalJordan);
  ev(H, "document.getElementById('globalSearch').value = 'yeezy'; globalSearch();");
  ok('M2  and the see-all button hands the query to the shop search',
    (() => { ev(H, 'seeAllSearch();'); return String(ev(H, "document.getElementById('filterSearch').value")) === 'yeezy'; })(),
    String(ev(H, "document.getElementById('filterSearch').value")));

  // ---- N. a sold listing keeps its page, wears a badge, leaves search -------
  // Sold pairs used to be removed from products.js by hand. That killed every
  // shared link to the pair and left a friend texting about a pair that was
  // gone. A listing now declares `sold: true` instead: the pair keeps its page
  // and its card, both wearing CLAIMED, and drops out of both searches.
  // No live listing is sold, so the proof runs on a synthetic pair pushed into
  // the shop's own array — the catalog file is never touched — and popped
  // again at the end of the section.
  const soldPair = { id: 999, brand: 'Jordan', name: 'Air Jordan 4 Retro Test Claimed', color: 'Test', condition: 'New', box: 'Original Box', sizes: ['11'], img: 'sneaker_images/square/test.jpg', gallery: ['sneaker_images/square/test.jpg'], sku: 'TEST999', sold: true };
  ev(H, 'products.push(' + JSON.stringify(soldPair) + ');');
  const jordan4Ids = catalog.filter((p) =>
    (p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.sku).toLowerCase().includes('jordan 4')).map((p) => p.id);
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('mobileSearch').value = ''; document.getElementById('sizeFilter').value = ''; renderShop();");
  const gridUnfiltered = String(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('N1  the unfiltered grid still shows the sold pair — the listing is not deleted',
    cardIds(gridUnfiltered).indexOf(999) >= 0 && /103 ITEMS AVAILABLE/.test(String(ev(H, "document.getElementById('productTotal').textContent"))),
    String(ev(H, "document.getElementById('productTotal').textContent")));
  ok('N2  and its card wears the CLAIMED badge',
    /claimed-badge">CLAIMED<\//.test(cardBlock(gridUnfiltered, 999)),
    cardBlock(gridUnfiltered, 999).slice(0, 400));
  ev(H, "document.getElementById('filterSearch').value = 'jordan 4'; renderShop();");
  const gridJordan4 = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('N3  the shop keyword search drops the sold pair but keeps the rest',
    gridJordan4.indexOf(999) < 0 && JSON.stringify(gridJordan4) === JSON.stringify(jordan4Ids),
    JSON.stringify(gridJordan4) + ' want ' + JSON.stringify(jordan4Ids));
  ev(H, "document.getElementById('filterSearch').value = '11'; renderShop();");
  const grid11Sold = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('N4  the shop size search drops it too, though it is held in 11',
    grid11Sold.indexOf(999) < 0 && grid11Sold.length > 0, JSON.stringify(grid11Sold));
  ev(H, "document.getElementById('globalSearch').value = 'jordan 4'; globalSearch();");
  const modalJordan4 = String(ev(H, "document.getElementById('searchResults').innerHTML"));
  ok('N5  the header modal drops it as well, and its see-all count excludes it',
    modalJordan4.indexOf('data-arg="999"') < 0 &&
      (jordan4Ids.length <= 4 || new RegExp('See all ' + jordan4Ids.length + ' results').test(modalJordan4)),
    modalJordan4.slice(0, 300));
  ev(H, "document.getElementById('filterSearch').value = ''; renderShop();");
  ev(H, 'renderProduct(999)');
  const soldDetails = String(ev(H, "document.getElementById('details').innerHTML"));
  ok('N6  its page still renders, with the CLAIMED badge on it',
    /claimed-badge">CLAIMED<\//.test(soldDetails) && soldDetails.indexOf('Air Jordan 4 Retro Test Claimed') >= 0,
    soldDetails.slice(0, 300));
  ok('N7  and the page offers no call or text button for it',
    soldDetails.indexOf('orderCall') < 0 && soldDetails.indexOf('orderText') < 0 &&
      /has been claimed/.test(soldDetails),
    soldDetails.slice(0, 300));
  ev(H, 'products.pop();');
  ev(H, "document.getElementById('filterSearch').value = ''; document.getElementById('mobileSearch').value = ''; document.getElementById('globalSearch').value = ''; renderShop();");

  // ---- O. the header search and the shop grid are one search -----------------
  // Typing in the header modal used to leave the grid behind it untouched: the
  // modal read "SEE ALL 6 RESULTS" for "Jordan 4" while the grid behind it
  // still read 102 ITEMS AVAILABLE, and the grid only caught up when "see all"
  // was clicked. Typing in the modal now filters the grid live, and "see all"
  // only closes the modal over a grid that already answers the query.
  ev(H, "document.getElementById('globalSearch').value = 'jordan 4'; globalSearch();");
  const gridLive = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('O1  typing in the modal filters the grid behind it, live and uncapped',
    JSON.stringify(gridLive) === JSON.stringify(jordan4Ids),
    JSON.stringify(gridLive) + ' want ' + JSON.stringify(jordan4Ids));
  ok('O2  and the grid count behind the modal answers the same query',
    String(ev(H, "document.getElementById('productTotal').textContent")) === jordan4Ids.length + ' ITEMS AVAILABLE',
    String(ev(H, "document.getElementById('productTotal').textContent")));
  ok('O3  see-all closes the modal over that same grid',
    (() => { ev(H, 'searchOpen();'); const wasOpen = ev(H, "document.getElementById('searchModal').classList.contains('open')"); ev(H, 'seeAllSearch();'); return wasOpen && !ev(H, "document.getElementById('searchModal').classList.contains('open')"); })() &&
      JSON.stringify(cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"))) === JSON.stringify(jordan4Ids),
    String(ev(H, "document.getElementById('filterSearch').value")));
  ev(H, "document.getElementById('globalSearch').value = ''; globalSearch();");
  const gridCleared = cardIds(ev(H, "document.getElementById('shopProducts').innerHTML"));
  ok('O4  clearing the modal clears the grid too',
    gridCleared.length === catalog.length && String(ev(H, "document.getElementById('productTotal').textContent")) === catalog.length + ' ITEMS AVAILABLE',
    String(ev(H, "document.getElementById('productTotal').textContent")));

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
