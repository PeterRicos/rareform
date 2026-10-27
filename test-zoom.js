/* Headless photo-zoom harness for index.html + styles.css + app.js (same folder)
   Run: node test-zoom.js   (or: node randomstock/test-zoom.js)

   Every listing draws its photos whole (object-fit: contain), which is the right way to
   browse — no silhouette is ever cut off — and useless for the thing this shop is
   actually selling on: the stitch line, the box label, the production stamp. Pressing a
   photo has to put that same file in front of the shopper, full-screen. What has to stay
   true:

     - a gallery photo is a real button, so looking closer is reachable from a keyboard
       and not only from a mouse
     - pressing photo N opens photo N, and it is the URL the gallery already loaded, so
       the viewer costs no second download and the two views cannot disagree
     - the arrows and the counter stay off a one-photo listing, which is every listing
       today; a gallery with several angles pages through them and wraps at both ends
     - nothing steps the viewer onto a blank frame, so an index past the end is ignored
     - Escape, a route change and the close button all take it down, and the viewer
       cannot be stacked on top of the search overlay
     - index.html asks for no image until a photo is picked
     - the sheet never scales the file up and leaves the phone's own pinch working, and
       .gallery-shot announces itself with cursor: zoom-in

   The page script is booted in a stub DOM and driven the way index.html drives it —
   through its inline handlers — so this runs anywhere Node runs.                    */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html');
const css = read('styles.css');

// products.js then app.js, exactly as index.html loads them (qrcode.js is deliberately
// left out: the viewer has nothing to do with it).
const CODE = read('products.js') + '\n' + read('app.js');

// Rules are read out of a comment-free copy: a /* ... */ block between two rules would
// otherwise be glued onto the next selector and that rule would look missing.
const CSS = css.replace(/\/\*[\s\S]*?\*\//g, '');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

// Declarations of every rule whose selector list contains `sel` exactly, joined in source
// order — the shape test-mobile.js reads the sheet with.
function decls(sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const sels = m[1].split(',').map((s) => flat(s).trim());
    if (sels.indexOf(sel) >= 0) out.push(flat(m[2]));
  }
  return out.length ? out.join(' ; ') : null;
}

// The value the browser ends up with: the last one declared.
const prop = (sel, name) => {
  const d = decls(sel);
  if (d === null) return null;
  const re = new RegExp('(?:^|;)\\s*' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+)', 'g');
  let m;
  let value = null;
  while ((m = re.exec(d))) value = m[1].trim();
  return value;
};

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
    // releaseFocus() detaches the Tab trap from whatever it was attached to, so the stub
    // has to carry both halves of the listener API — and the rects trapKeydown filters by.
    removeEventListener: () => {},
    getClientRects: () => [],
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

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);
  const H = boot('');
  await sleep(320);

  const get = (id) => H.getEl(id);
  const gallery = () => String(get('gallery').innerHTML);
  const isOpen = () => get('zoom')._classes.has('open');
  const zoomSrc = () => String(get('zoomImg').src);
  const zoomAlt = () => String(get('zoomImg').alt);
  const counter = () => String(get('zoomCount').textContent);
  const render = (id) => ev(H, 'renderProduct(' + id + ')');
  // Fire a key the way the browser would: at the handler app.js registered on window.
  const key = (k) => (H.listeners.window.keydown || []).forEach((fn) => fn({ key: k }));
  const catalog = ev(H, 'window.localProducts');
  const pick = (needle) => catalog.find((p) => p.name.indexOf(needle) >= 0);

  // ---- A. a photo is a button, and it says what it opens ------------------------
  const jordan = pick('Jubilee');
  render(jordan.id);
  const a = gallery();
  ok('A1  each photo is drawn as its own button',
    /^\s*<button class="gallery-shot" type="button" data-act="zoomOpen" data-arg="0"/.test(a), a.slice(0, 160));
  // A lone photo is the listing's main image and sits above the fold, so it is drawn
  // eager and at high priority; the rest of a gallery stays lazy. Either way the src
  // is the listing's own image, root-relative (a bare catalog path would resolve
  // against the listing URL after pushState and break every lazy angle).
  ok('A2  the photo inside it is still the listing image',
    a.indexOf('<img src="/' + jordan.img + '" alt="' + jordan.name + '"') >= 0
      && /<img [^>]*loading="(lazy|eager)"[^>]*decoding="async"[^>]*>/.test(a), a.slice(0, 300));
  ok('A3  and the button announces what pressing it does',
    a.indexOf('aria-label="Zoom in on ' + jordan.name + '"') >= 0, a.slice(0, 240));
  ok('A4  one photo is still one photo', !/gallery-shot[\s\S]*gallery-shot/.test(a), a);

  // ---- B. the catalog's "&" listing stays escaped in markup, real in the DOM ----
  const bearbrick = pick('Bearbrick');
  render(bearbrick.id);
  const b = gallery();
  ok('B1  the label is escaped where it is printed into markup',
    b.indexOf('100% &amp; 400%') >= 0 && b.indexOf('100% & 400%') < 0, b.slice(0, 220));

  // ---- C. pressing photo N opens photo N ---------------------------------------
  ev(H, 'zoomOpen(0)');
  ok('C1  the viewer is up', isOpen());
  ok('C2  showing the photo that was pressed', zoomSrc() === '/' + bearbrick.img, zoomSrc() + ' vs ' + bearbrick.img);
  ok('C3  it is the URL the gallery already loaded, so nothing is fetched twice',
    gallery().indexOf('src="' + zoomSrc() + '"') >= 0);
  ok('C4  the alt handed to the viewer is the real name, not the escaped markup',
    zoomAlt() === bearbrick.name, zoomAlt());
  ok('C5  a one-photo listing shows no arrows',
    get('zoomPrev').hidden === true && get('zoomNext').hidden === true);
  ok('C6  and no "1 / 1" counter', counter() === '', counter());
  ev(H, 'searchOpen(); zoomOpen(0);');
  ok('C7  the viewer never stacks on the search overlay',
    isOpen() && !get('searchModal')._classes.has('open'));

  // ---- D. nothing can step a listing off its only photo ------------------------
  ev(H, 'zoomStep(1)');
  ok('D1  stepping a one-photo listing is a no-op',
    zoomSrc() === '/' + bearbrick.img && counter() === '', zoomSrc() + ' ' + counter());
  ev(H, 'zoomShow(4)');
  ok('D2  an index past the end cannot blank the frame', zoomSrc() === '/' + bearbrick.img, zoomSrc());

  // ---- E. a gallery with angles pages through them -----------------------------
  const pair = pick('Jubilee');
  const oneAngle = pair.gallery;
  pair.gallery = [pair.img, 'sneaker_images/square/Jubilee-angle-2.jpg'];
  render(pair.id);
  const e = gallery();
  ok('E1  a two-angle listing draws two buttons', /data-act="zoomOpen" data-arg="0"[\s\S]*data-act="zoomOpen" data-arg="1"/.test(e));
  ok('E2  and names the second one as an angle',
    e.indexOf('alt="' + pair.name + ' angle 2"') >= 0, e.slice(0, 240));
  ev(H, 'zoomOpen(1)');
  ok('E3  pressing the second button shows the second photo',
    zoomSrc() === '/sneaker_images/square/Jubilee-angle-2.jpg', zoomSrc());
  ok('E4  the arrows come out with a second angle',
    get('zoomPrev').hidden === false && get('zoomNext').hidden === false);
  ok('E5  the counter says which angle is up', counter() === '2 / 2', counter());
  ev(H, 'zoomStep(1)');
  ok('E6  stepping past the last wraps to the first',
    zoomSrc() === '/' + pair.img && counter() === '1 / 2', zoomSrc() + ' ' + counter());
  ev(H, 'zoomStep(-1)');
  ok('E7  stepping back from the first wraps to the last',
    zoomSrc() === '/sneaker_images/square/Jubilee-angle-2.jpg' && counter() === '2 / 2', counter());
  ev(H, 'zoomStep(1)');
  key('ArrowRight');
  ok('E8  the right arrow steps forward while the viewer is up',
    zoomSrc() === '/sneaker_images/square/Jubilee-angle-2.jpg', zoomSrc());
  key('ArrowLeft');
  ok('E9  the left arrow steps back', zoomSrc() === '/' + pair.img, zoomSrc());
  pair.gallery = oneAngle;
  ev(H, 'renderProduct(' + pair.id + '); zoomOpen(0);');
  ok('E10  dropping the extra angle puts the arrows and the counter away again',
    !/gallery-shot[\s\S]*gallery-shot/.test(gallery()) && get('zoomPrev').hidden === true && counter() === '');

  // ---- F. every way out closes it ----------------------------------------------
  ok('F1  the viewer is open to start with', isOpen());
  ev(H, 'zoomClose()');
  ok('F2  the close button takes it down', !isOpen());
  let threw = null;
  try { ev(H, 'zoomClose()'); } catch (err) { threw = err; }
  ok('F3  closing a closed viewer is harmless', !threw, threw && threw.message);
  ev(H, 'zoomOpen(0)');
  key('Escape');
  ok('F4  Escape closes it', !isOpen());
  ev(H, 'zoomOpen(0)');
  ev(H, "go('shop')");
  ok('F5  a route change cannot leave it up over the new view', !isOpen());
  key('ArrowRight');
  ok('F6  the arrow keys leave a closed viewer closed', !isOpen());

  // ---- G. what index.html ships -------------------------------------------------
  ok('G1  the viewer is a dialog',
    /<section class="zoom" id="zoom" role="dialog" aria-modal="true"/.test(html));
  ok('G2  its image asks for no file until a photo is picked',
    /<img id="zoomImg" alt="">/.test(html));
  ok('G3  the close button is labelled for a screen reader',
    /class="zoom-close" type="button" data-act="zoomClose" aria-label="Close photo viewer"/.test(html));
  ok('G4  the arrows ship hidden',
    html.indexOf('id="zoomPrev" data-act="zoomStep" data-arg="-1" aria-label="Previous photo" hidden') >= 0 &&
    html.indexOf('id="zoomNext" data-act="zoomStep" data-arg="1" aria-label="Next photo" hidden') >= 0);
  ok('G5  the counter is decoration, not content', /class="zoom-count" id="zoomCount" aria-hidden="true"/.test(html));

  // ---- H. what the sheet promises the browser -----------------------------------
  ok('H1  the gallery announces itself as something that opens',
    prop('.gallery-shot', 'cursor') === 'zoom-in', prop('.gallery-shot', 'cursor'));
  ok('H2  but the photo is still drawn whole',
    prop('.gallery-shot img', 'object-fit') === 'contain', prop('.gallery-shot img', 'object-fit'));
  ok('H3  the viewer sits above the dialogs and below the toast',
    Number(prop('.zoom', 'z-index')) === 80 &&
    Number(prop('.order-modal', 'z-index')) === 70 &&
    Number(prop('.toast', 'z-index')) === 90);
  ok('H4  a one-photo listing can still hide its arrows',
    prop('.zoom-step[hidden]', 'display') === 'none', prop('.zoom-step[hidden]', 'display'));
  ok('H5  the file is never scaled up by us',
    prop('.zoom img', 'width') === 'auto' && prop('.zoom img', 'height') === 'auto' &&
    prop('.zoom img', 'max-width') === '100%' && prop('.zoom img', 'max-height') === '100%',
    [prop('.zoom img', 'width'), prop('.zoom img', 'max-height')].join(' '));
  ok('H6  so the phone\'s own pinch stays available',
    prop('.zoom img', 'touch-action') === 'pinch-zoom', prop('.zoom img', 'touch-action'));
  ok('H7  the viewer is inert while it is closed',
    prop('.zoom', 'visibility') === 'hidden' && prop('.zoom', 'pointer-events') === 'none');
  ok('H8  and comes up when it is opened',
    prop('.zoom.open', 'visibility') === 'visible' && prop('.zoom.open', 'pointer-events') === 'auto');
  ok('H9  its controls are thumb-sized',
    ['.zoom-close', '.zoom-step'].every((sel) =>
      prop(sel, 'min-width') === '44px' && prop(sel, 'min-height') === '44px'),
    prop('.zoom-close', 'min-width') + ' ' + prop('.zoom-step', 'min-height'));

  const fails = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
  console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();