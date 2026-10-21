/* Headless listing-QR harness for app.js (same folder)
   Run: node test-listing-qr.js   (or: node randomstock/test-listing-qr.js)

   Every listing carries a QR code for the shopper who is on a computer: a desktop has
   nowhere to hand an sms: link to, so the code is what puts the item into the phone in
   their pocket. What it has to keep true:
     - it is drawn on the listing next to the order buttons, not only inside the dialog
     - it encodes exactly the href the Text button carries, so the code and the button
       can never name different items, SKUs or sizes
     - that message names the item, the SKU and the size the shopper has selected
     - picking another size redraws it, so it never carries a stale size
     - a catalog name containing "&" cannot break the markup the sentence is printed into
     - with qrcode.js missing the block still says something usable and does not throw

   The modules are read back out of the drawn SVG and compared with the library's own
   matrix for the expected URI. A scanner reads modules, so modules are what gets
   checked — not the markup that happens to carry them.                          */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const QR_SRC = read('qrcode.js');
const CODE = read('products.js') + '\n' + read('app.js');
const bootCode = (withQr) => (withQr ? QR_SRC + '\n' : '') + CODE;

// A second instance of the same library, used only to work out which modules the
// expected URI should produce. Same UTF-8 converter app.js installs on first draw.
const lib = new Function(QR_SRC + '\nreturn qrcode;')();
lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];

const structuredData = require('./jsonld.js');
// The digits live in jsonld.js only (see its note near PHONE); the tests read the
// assembled number back from it instead of writing it out, so a committed test can
// never leak the number again.
const PHONE = structuredData.PHONE;
const DISPLAY = structuredData.PHONE_DISPLAY;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function boot(initialHash, withQr) {
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
  new vm.Script(bootCode(withQr), { filename: 'randomstock-inline.js' }).runInContext(ctx);

  return { win, doc, history, location, pages, getEl, listeners, ctx, Observer };
}

// Read the dark modules back out of the drawn SVG. qrSvg emits one path of
// "M<col> <row>h<run>v1h-<run>z" runs inside a quiet zone, so this is the same
// picture a camera would see, minus the pixels.
function modulesFromSvg(svg) {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(String(svg));
  if (!vb) return null;
  const quiet = 4;
  const size = Number(vb[1]);
  const dark = new Set();
  const re = /M(\d+) (\d+)h(\d+)v1h-\d+z/g;
  let m;
  while ((m = re.exec(String(svg)))) {
    const x = Number(m[1]) - quiet, y = Number(m[2]) - quiet;
    for (let i = 0; i < Number(m[3]); i += 1) dark.add(y + ',' + (x + i));
  }
  return { size, count: size - quiet * 2, dark: [...dark].sort() };
}

// What the modules should be for a given URI.
function libModules(uri) {
  const qr = lib(0, 'M');
  qr.addData(uri);
  qr.make();
  const n = qr.getModuleCount();
  const dark = [];
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) dark.push(r + ',' + c);
  return { count: n, dark: dark.sort() };
}

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);
  const H = boot('', true);
  await sleep(320);

  const block = () => String(ev(H, "document.getElementById('listingQr').innerHTML"));
  const textHref = () => String(ev(H, "document.getElementById('orderText').href"));
  const bodyOf = (href) => decodeURIComponent(String(href).replace(/^[^?]*\?&?body=/, ''));
  const render = (id) => ev(H, 'renderProduct(' + id + ')');
  const catalog = ev(H, 'window.localProducts');
  const pick = (needle) => catalog.find((p) => p.name.indexOf(needle) >= 0);

  // ---- A. the listing itself carries the code, next to the order buttons -------
  const jordan = pick('Jubilee');
  render(jordan.id);
  const a = block();
  ok('A1  the listing draws a code, not just the dialog', /^<div class="listing-qr-code"><svg /.test(a), a.slice(0, 120));
  ok('A2  the code is labelled for screen readers',
    new RegExp('role="img" aria-label="QR code that opens a text to ' + escRe(DISPLAY)).test(a));

  // ---- B. the code and the Text button carry the same sentence -----------------
  const drawn = modulesFromSvg(a);
  const want = libModules(textHref());
  ok('B1  the drawn modules are the QR of the Text button href',
    drawn && drawn.count === want.count && JSON.stringify(drawn.dark) === JSON.stringify(want.dark),
    drawn ? drawn.count + ' modules vs ' + want.count : 'no viewBox in ' + a.slice(0, 80));
  ok('B2  the payload is an sms: URI to the shop number',
    new RegExp('^sms:' + escRe(PHONE) + '\\?&body=').test(textHref()), textHref().slice(0, 60));
  const body = bodyOf(textHref());
  ok('B3  the message names the item, its SKU and the chosen size',
    body.indexOf(jordan.name) >= 0 && body.indexOf(jordan.sku) >= 0 && body.indexOf('size US ' + jordan.sizes[0]) >= 0,
    body);
  ok('B4  the note prints that same sentence', a.indexOf(jordan.name) >= 0 && a.indexOf(jordan.sku) >= 0);

  // ---- C. changing the size redraws the code -----------------------------------
  ev(H, "selectSize('12', { classList: { add: function () {} } })");
  const c = block();
  const drawnC = modulesFromSvg(c);
  const wantC = libModules(textHref());
  ok('C1  another size redraws a different code',
    JSON.stringify(drawnC.dark) !== JSON.stringify(drawn.dark));
  ok('C2  the redrawn code matches the Text button for that size',
    JSON.stringify(drawnC.dark) === JSON.stringify(wantC.dark));
  ok('C3  the redrawn sentence carries the new size',
    bodyOf(textHref()).indexOf('size US 12') >= 0 && c.indexOf('size US 12') >= 0, bodyOf(textHref()));

  // ---- D. a listing with no sizes says nothing about sizes ---------------------
  const huffy = pick('Huffy');
  render(huffy.id);
  const bodyD = bodyOf(textHref());
  ok('D1  an item with no sizes still names itself and its SKU',
    bodyD.indexOf(huffy.name) >= 0 && bodyD.indexOf(huffy.sku) >= 0, bodyD);
  ok('D2  no dangling "size" for an item that has none', bodyD.indexOf(', size ') < 0, bodyD);

  // ---- E. the catalog's "&" name is escaped, and only in the markup ------------
  const bearbrick = pick('Bearbrick');
  render(bearbrick.id);
  const e = block();
  ok('E1  the sentence is escaped where it is printed',
    e.indexOf('100% &amp; 400%') >= 0 && e.indexOf('100% & 400%') < 0, e.slice(e.indexOf('listing-qr-message'), 90));
  ok('E2  the code\'s own label is escaped too', /aria-label="[^"]*100% &amp; 400%/.test(e));
  ok('E3  the payload still carries the real ampersand',
    bodyOf(textHref()).indexOf('100% & 400%') >= 0, bodyOf(textHref()));
  const drawnE = modulesFromSvg(e);
  const wantE = libModules(textHref());
  ok('E4  the ampersand item draws a valid code for its own sentence',
    JSON.stringify(drawnE.dark) === JSON.stringify(wantE.dark), drawnE.count + ' modules vs ' + wantE.count);
  ok('E5  even the worst item fits the 57 modules .listing-qr-code is sized for',
    drawnE.count <= 57, 'modules ' + drawnE.count);
  const w = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(e);
  const box = Number(/viewBox="0 0 (\d+) /.exec(e)[1]);
  ok('E6  every module is drawn a whole number of pixels wide',
    !!w && Number(w[1]) === box * 4 && w[1] === w[2],
    w ? w[1] + 'px for ' + box + ' modules' : 'no width/height on the svg');

  // ---- F. without qrcode.js the block still says something usable --------------
  const H2 = boot('', false);
  await sleep(320);
  let threw = null;
  try { vm.runInContext('renderProduct(' + jordan.id + ')', H2.ctx); } catch (err) { threw = err; }
  const f = String(vm.runInContext("document.getElementById('listingQr').innerHTML", H2.ctx));
  ok('F1  a missing qrcode.js does not throw', !threw, threw && threw.message);
  ok('F2  the block still names the number', f.indexOf(DISPLAY) >= 0, f.slice(0, 140));
  ok('F3  and draws no half-built svg', f.indexOf('<svg') < 0);

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
