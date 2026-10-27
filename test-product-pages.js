/* Prerendered listing pages: /product/<slug>/ (same folder)
   Run: node test-product-pages.js

   Every pair used to live at "#product/3" — a hash on the homepage. That is not an
   address: all 102 listings shared one URL, so a crawler had one page to index, a shared
   link opened the hero, and ctrl-click on a card did nothing. prerender-products.js now
   writes a real page per pair and app.js links to it.

   This suite pins the three things that make that real rather than decorative:

     A. the files — one per listing, each naming its own pair (title, description,
        canonical, Open Graph, Product JSON-LD), each readable without JavaScript, none
        of them dragging the homepage's 1.7 MB clip along;
     B. the links — a card is an <a href> to that page, not a <button>, and the shop is
        still one click deep because a plain click stays in the document;
     C. the routing — a page loaded at /product/<slug>/ opens that pair (not the hero),
        and a ctrl/cmd-click is never cancelled, so "open in new tab" reaches the page.

   The harness stubs a served-from-a-subdirectory document (https, pathname
   /product/<slug>/) because that is the only place the path routes exist: app.js falls
   back to the hash routes when it cannot see a pathname, which is what test-route.js
   still covers.                                                              */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const slugs = require('./slugs.js');
const structuredData = require('./jsonld.js');
const { readCatalog, esc } = require('./prerender-products.js');

const catalog = readCatalog();
const OUT = path.join(__dirname, 'product');
const slugOf = new Map(catalog.map((p) => [slugs.productSlug(p), p]));

// ---- A. the files on disk ---------------------------------------------------
const dirs = fs.existsSync(OUT)
  ? fs.readdirSync(OUT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : [];
const readPage = (d) => {
  const file = path.join(OUT, d, 'index.html');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

// Renaming a listing moves its page, and prerender-products.js leaves a small "moved" page
// at the old address (redirects.js) so the old link still lands somewhere. Those folders
// are signposts, not listings: A1-A4 count listing pages, and the stubs get A20-A23.
const redirects = require('./redirects.js');
const skuOf = new Map(catalog.map((p) => [String(p.sku).toUpperCase(), p]));
const retired = Object.keys(redirects).filter((from) => {
  const p = skuOf.get(String(redirects[from]).toUpperCase());
  return p && slugs.productSlug(p) !== from && !slugOf.has(from);
});
const pageDirs = dirs.filter((d) => retired.indexOf(d) < 0);

ok('A1  there is a page for every listing', pageDirs.length === catalog.length,
  'pages=' + pageDirs.length + ' listings=' + catalog.length);
ok('A2  and no page for a listing that is gone',
  pageDirs.every((d) => slugOf.has(d)),
  pageDirs.filter((d) => !slugOf.has(d)).slice(0, 3).join(', '));
ok('A3  every slug is a plain URL safe to paste anywhere',
  pageDirs.every((d) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d) && d.length <= 90),
  pageDirs.filter((d) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d)).slice(0, 3).join(', '));

const pages = new Map(pageDirs.map((d) => [d, readPage(d)]));
ok('A4  every page directory holds an index.html',
  pageDirs.every((d) => pages.get(d).length > 0),
  pageDirs.filter((d) => !pages.get(d).length).slice(0, 3).join(', '));

// Every head field has to name *this* pair. One wrong canonical does not throw: it
// silently points a crawler at another product, which is worse than no tag at all.
const badCanonical = [];
const badTitle = [];
const longDescription = [];
pages.forEach((html, slug) => {
  const p = slugOf.get(slug);
  const url = slugs.productUrl(p);
  const canon = html.includes('<link rel="canonical" href="' + url + '">');
  const ogUrl = html.includes('<meta property="og:url" content="' + url + '">');
  const ogType = html.includes('<meta property="og:type" content="product">');
  if (!canon || !ogUrl || !ogType) {
    badCanonical.push(slug + ' [' + [canon && 'canonical', ogUrl && 'og:url', ogType && 'og:type']
      .filter(Boolean).join('+') + ']');
  }
  if (!html.includes('<title>' + esc(p.name + ' ' + p.sku + ' — Random Stock') + '</title>')) badTitle.push(slug);
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  if (!desc || desc.length > 160) longDescription.push(slug + '=' + desc.length);
});
ok('A5  every page is canonically itself (canonical + og:url + og:type)',
  badCanonical.length === 0, badCanonical.slice(0, 3).join(', '));
ok('A6  every page title names its pair and its SKU',
  badTitle.length === 0, badTitle.slice(0, 3).join(', '));
ok('A7  every description fits in a result snippet (≤160 chars)',
  longDescription.length === 0, longDescription.slice(0, 3).join(', '));

// ---- A8-A12: what a crawler or a reader without JavaScript actually gets -----
// These are the pages' reason to exist, so they are checked on the markup itself
// rather than through the page script — nothing here may depend on app.js running.
const missingFacts = [];
const notActive = [];
const deadButtons = [];
const brokenImages = [];
const relativeRefs = [];
const heroLeftovers = [];

pages.forEach((html, slug) => {
  const p = slugOf.get(slug);
  const facts = [p.name, p.sku, p.condition, (p.sizes || []).join(', '), p.brand]
    .filter(Boolean).filter((fact) => html.indexOf(fact.replace(/&/g, '&amp;').replace(/</g, '&lt;')) < 0);
  if (facts.length) missingFacts.push(slug + ' [' + facts.join(' | ') + ']');

  // The page was served for this pair, so the pair is the view it shows — before any
  // script runs. The homepage's hero must not be the active view on a listing.
  if (!/<div id="view-product" data-view="product" class="page active">/.test(html) ||
      !/<div id="view-home" data-view="home" class="page">/.test(html)) notActive.push(slug);

  // Sizes are written as text, not as the shop's size buttons: a button that cannot
  // select anything without a script is worse than a sentence.
  const details = (html.match(/<div class="details" id="details">([\s\S]*?)\n\s*<\/div>\s*<\/div>/)
    || ['', ''])[1];
  if (/<button\b/.test(details)) deadButtons.push(slug);

  // The photo is the page's content; a path that 404s is the one failure a crawler
  // cannot see and a shopper sees immediately.
  const shots = html.match(/<div class="gallery-shot">[\s\S]*?<img src="([^"]+)"/g) || [];
  shots.forEach((chunk) => {
    const src = (chunk.match(/<img src="([^"]+)"/) || [])[1] || '';
    if (src.charAt(0) !== '/' || !fs.existsSync(path.join(__dirname, src.replace(/^\//, '')))) {
      brokenImages.push(slug + ' -> ' + src);
    }
  });
  if (!shots.length) brokenImages.push(slug + ' (no photo at all)');

  // Two directories down, every relative path points inside /product/<slug>/ and 404s.
  const rel = html.match(/\s(?:src|href)="(?!https?:|\/\/|\/|#|data:|mailto:|tel:|sms:)[^"]*"/g) || [];
  if (rel.length) relativeRefs.push(slug + ' ' + rel.slice(0, 2).join(' '));

  // A listing page has no hero, so it must not pull the homepage's 1.7 MB clip or
  // claim its still as a high-priority fetch. The <video> tag is the signal, not the
  // word "reel.mp4" — the explanatory comment above it stays in the page, and an
  // unrequested file named in a comment costs nothing.
  if (/<video\b/.test(html) || /fetchpriority="high"/.test(html)) heroLeftovers.push(slug);
});

ok('A8  the name, brand, SKU, condition and sizes are in the HTML itself',
  missingFacts.length === 0, missingFacts.slice(0, 2).join(' ; '));
ok('A9  the product view is the active one, and the homepage hero is not',
  notActive.length === 0, notActive.slice(0, 3).join(', '));
ok('A10 no dead controls: the pre-rendered details carry no buttons',
  deadButtons.length === 0, deadButtons.slice(0, 3).join(', '));
ok('A11 the pre-rendered photo is root-absolute and really on disk',
  brokenImages.length === 0, brokenImages.slice(0, 2).join(' ; '));
ok('A12 no relative asset path is left to 404 from two directories down',
  relativeRefs.length === 0, relativeRefs.slice(0, 2).join(' ; '));
ok('A13 a listing page carries neither the hero clip nor a high-priority hero photo',
  heroLeftovers.length === 0, heroLeftovers.slice(0, 3).join(', '));

// ---- A14: the structured data names this pair, and no telephone ---------------
// The block is written into the repo, so it must stay as phone-free as the catalog
// block in index.html (test-privacy.js sweeps every file for the same leak).
const jsonLdProblems = [];
pages.forEach((html, slug) => {
  const p = slugOf.get(slug);
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  if (blocks.length !== 1) { jsonLdProblems.push(slug + ' blocks=' + blocks.length); return; }
  let node;
  try {
    node = JSON.parse(blocks[0].replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  } catch (err) {
    jsonLdProblems.push(slug + ' unparseable'); return;
  }
  const product = (node['@graph'] || []).find((n) => n['@type'] === 'Product');
  if (!product) { jsonLdProblems.push(slug + ' no Product'); return; }
  if (product.url !== slugs.productUrl(p)) jsonLdProblems.push(slug + ' url=' + product.url);
  if (product.sku !== p.sku) jsonLdProblems.push(slug + ' sku=' + product.sku);
  if (!product.offers || product.offers.availability !== 'https://schema.org/InStock') {
    jsonLdProblems.push(slug + ' availability');
  }
  if (/telephone/.test(blocks[0])) jsonLdProblems.push(slug + ' telephone');
  const shoot = String((product.image || [])[0] || '');
  if (!/^https:\/\/randomstock\.shop\//.test(shoot)) jsonLdProblems.push(slug + ' image=' + shoot);
});
ok('A14 each page\'s JSON-LD describes that page\'s pair, with no telephone in it',
  jsonLdProblems.length === 0, jsonLdProblems.slice(0, 3).join(' ; '));

// ---- A15: the sitemap is the list of these pages -----------------------------
const sitemap = read('sitemap.xml');
const locs = (sitemap.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, ''));
const expected = [structuredData.SITE_URL].concat(catalog.map((p) => slugs.productUrl(p)));
ok('A15 the sitemap lists the homepage and every pair exactly once',
  locs.length === expected.length &&
  new Set(locs).size === locs.length &&
  expected.every((url) => locs.indexOf(url) >= 0),
  'locs=' + locs.length + ' expected=' + expected.length +
  ' missing=' + expected.filter((u) => locs.indexOf(u) < 0).slice(0, 2).join(', '));

// ---- A16: each pair's photo is in that pair's entry ---------------------------
// Image search is how a pair nobody knows by name gets found. What makes that worth
// having is the pairing being right: a photo filed under the wrong URL would advertise
// one pair on another's page. The block is split per <url> so the check is on the
// association, not on the presence of some <image:loc> somewhere in the file.
const blocks = sitemap.split('  <url>').slice(1);
const sourced = (url) => {
  try { return decodeURI(url); } catch (err) { return url; }
};
const photoProblems = [];
blocks.forEach((block) => {
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1] || '';
  const shot = sourced((block.match(/<image:loc>([^<]+)<\/image:loc>/) || [])[1] || '');
  if (loc === structuredData.SITE_URL) return;            // the homepage advertises no photo
  const slug = loc.replace(structuredData.SITE_URL + 'product/', '').replace(/\/$/, '');
  const p = catalog.filter((x) => slugs.productSlug(x) === slug)[0];
  if (!p) { photoProblems.push(slug + ' unknown'); return; }
  const want = structuredData.SITE_URL + String(p.img || '').replace(/^\/+/, '');
  if (shot !== want) photoProblems.push(slug + ' photo=' + shot);
});
ok('A16 every pair carries its own photo, and no one else\'s',
  /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/.test(sitemap) &&
  blocks.length === expected.length &&
  photoProblems.length === 0,
  'blocks=' + blocks.length + ' ' + photoProblems.slice(0, 3).join(' ; '));

// ---- A17: the listed photos are files that exist ------------------------------
// Pages is case-sensitive, so "(1).JPG" for "(1).jpg" is a 404 that still looks like a
// perfectly good sitemap entry. Checking the disk is the only way to know.
const missingPhoto = catalog.filter((p) => {
  const src = String(p.img || '').replace(/^\/+/, '');
  return !src || !fs.existsSync(path.join(__dirname, src));
});
ok('A17 every photo the sitemap advertises is a file in this folder',
  missingPhoto.length === 0,
  missingPhoto.slice(0, 3).map((p) => String(p.img)).join(' ; '));

// ---- A18: one top-level heading per document ----------------------------------
// A listing page used to announce four <h1>s: the homepage headline, the shop title,
// "BUILT AROUND THE PAIR." and the pair's name. Three of those head views the page
// hides, so the pair competed with three other headings for the top of the outline.
// Now it is the only one, and the homepage keeps exactly one of its own. Counting the
// tags is not enough — a page with one <h1> that names something else is still wrong,
// so the single heading has to name the pair.
const headingProblems = [];
pageDirs.forEach((d) => {
  const p = slugOf.get(d);
  const html = pages.get(d) || '';
  const marks = html.match(/<h1[\s>]/g) || [];
  if (marks.length !== 1) { headingProblems.push(d + ' h1s=' + marks.length); return; }
  const block = (html.match(/<h1[\s>][\s\S]*?<\/h1>/) || [])[0] || '';
  if (!p || block.indexOf(esc(p.name)) < 0) headingProblems.push(d + ' h1 names another pair');
});
const homeHtml = read('index.html');
const homeH1 = (homeHtml.match(/<h1[\s>]/g) || []).length;
ok('A18 each page has one top-level heading, and on a listing it is the pair',
  headingProblems.length === 0 && homeH1 === 1,
  headingProblems.slice(0, 3).join(' ; ') + (homeH1 === 1 ? '' : ' home h1s=' + homeH1));

// ---- A19: the homepage description fits in a result snippet -------------------
// Product descriptions were already held to 160 characters (A7). The homepage's was
// 191, so Google cut it mid-sentence right after "inspected by hand". Same limit,
// same reason: the part past the cut is a part nobody reads.
const homeDesc = (homeHtml.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
ok('A19 the homepage description fits in a result snippet (≤160 chars)',
  homeDesc.length > 0 && homeDesc.length <= 160,
  homeDesc.length + ' chars: ' + homeDesc);

// ---- A20-A23: retired addresses still land on the pair ------------------------
// Correcting a listing's name moves its page, because the slug is derived from the name.
// A static host cannot answer the old URL with a 301, so the only redirect available is a
// page still sitting at the old address (redirects.js). Without it, every link already out
// there — a DM, a bookmark, a search result — reaches a 404, and a 404 on a pair that is
// still for sale reads as "sold".
const stubDirs = dirs.filter((d) => retired.indexOf(d) !== -1);
ok('A20 every retired address still has a page on disk', stubDirs.length === retired.length,
  'stubs=' + stubDirs.length + ' retired=' + retired.length +
  ' missing=' + retired.filter((d) => stubDirs.indexOf(d) < 0).join(', '));

const badStub = [];
stubDirs.forEach((d) => {
  const p = skuOf.get(String(redirects[d]).toUpperCase());
  const html = readPage(d);
  const to = '/product/' + slugs.productSlug(p) + '/';
  if (html.indexOf('<link rel="canonical" href="' + structuredData.SITE_URL + to.replace(/^\//, '') + '">') < 0) badStub.push(d + ' canonical');
  if (html.indexOf('url=' + to + '"') < 0) badStub.push(d + ' refresh');
  if (html.indexOf('href="' + to + '"') < 0) badStub.push(d + ' link');
  if ((html.match(/<h1[\s>]/g) || []).length) badStub.push(d + ' has an <h1>');
});
ok('A21 each stub points at its pair\'s current page (canonical + meta refresh + link)',
  badStub.length === 0, badStub.slice(0, 3).join(' ; '));

// The reverse of A20: nothing of the site's own may still point at an old address. A stub
// is a courtesy for links that left the building; a link from the shop itself to a signpost
// means a slug was hard-coded somewhere instead of derived.
const appCode = read('app.js');
const staleLinks = [];
retired.forEach((d) => {
  const needle = '/product/' + d + '/';
  if (homeHtml.indexOf(needle) >= 0) staleLinks.push('index.html → ' + d);
  if (appCode.indexOf(needle) >= 0) staleLinks.push('app.js → ' + d);
  pages.forEach((html, slug) => { if (html.indexOf(needle) >= 0) staleLinks.push(slug + ' → ' + d); });
});
ok('A22 nothing on the site still links to a retired address',
  staleLinks.length === 0, staleLinks.slice(0, 3).join(' ; '));

const stubInSitemap = retired.filter((d) => sitemap.indexOf('/product/' + d + '/') >= 0);
ok('A23 the sitemap lists only live pages, never a stub',
  stubInSitemap.length === 0, stubInSitemap.join(', '));

// The visible color line repeats the name on most listings, so the static page
// omits it when the name already says the colorway (app.js and
// prerender-products.js share the rule): a page that still prints one is a page
// whose rule drifted from the shop's.
const repeatingColor = [];
pages.forEach((html, slug) => {
  const p = slugOf.get(slug);
  if (!p) return;
  const m = html.match(/<p class="color"[^>]*>([^<]*)<\/p>/);
  if (!m) return;
  const color = m[1].replace(/&amp;/g, '&').replace(/\([^)]*\)/g, '').trim().toLowerCase();
  if (color && String(p.name).toLowerCase().indexOf(color) >= 0) repeatingColor.push(slug);
});
ok('A24 no listing page prints a color line its name already says',
  repeatingColor.length === 0, repeatingColor.slice(0, 3).join(', '));

// ---- B. the page script, on a listing URL ------------------------------------
// The live page loads slugs.js, products.js and app.js in that order.
const CODE = [read('slugs.js'), read('products.js'), read('app.js')].join('\n');

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
    closest: () => el,
    querySelector: () => null,
    querySelectorAll: () => [],
    scrollIntoView: (opts) => { el._scrolled = opts || true; }
  };
  return el;
}

// The grids are revealed by an IntersectionObserver, which Node does not have. The stub
// never fires by itself; app.js only needs to be able to hand it cards.
function makeObserver() {
  function Observer(cb) {
    this.cb = cb;
    this.observe = () => {};
    this.unobserve = () => {};
    this.disconnect = () => {};
    this.takeRecords = () => [];
  }
  return Observer;
}

// pathname is the whole point of this harness: it is what tells app.js the document was
// served for a listing. base is the depth the generator stamps on <html>.
function boot(pathname, hash, base) {
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
  const addL = (target, t, fn) => { (listeners[target][t] = listeners[target][t] || []).push(fn); };
  const fire = (target, t, ev) => (listeners[target][t] || []).forEach((fn) => fn(ev));

  const doc = {
    title: '',
    body: makeEl('body'),
    documentElement: {
      getAttribute: (name) => (name === 'data-asset-base' ? (base || null) : null),
      classList: { add: () => {}, remove: () => {}, contains: () => false }
    },
    getElementById: getEl,
    querySelectorAll: (sel) => (sel === '.page' ? PAGE_IDS.map((id) => pages[id]) : []),
    querySelector: (sel) => (sel === '.page.active'
      ? PAGE_IDS.map((id) => pages[id]).find((p) => p._classes.has('active')) || null
      : null),
    addEventListener: (t, fn) => addL('document', t, fn),
    createElement: () => makeEl('created')
  };

  // A history entry is a path *and* a hash here. pushState('#shop') keeps the current
  // path; pushState('/#shop') moves to the root — the difference urlFor() has to get
  // right when the shopper leaves a listing page.
  const stack = [{ state: null, path: pathname || '/', hash: hash || '' }];
  let idx = 0;
  const split = (url) => {
    if (url == null || url === '') return { path: stack[idx].path, hash: stack[idx].hash };
    const s = String(url);
    if (s.charAt(0) === '#') return { path: stack[idx].path, hash: s };
    const i = s.indexOf('#');
    return { path: i < 0 ? s : s.slice(0, i), hash: i < 0 ? '' : s.slice(i) };
  };
  const location = {
    protocol: 'https:',
    get pathname() { return stack[idx].path; },
    get hash() { return stack[idx].hash; },
    set hash(v) { stack[idx].hash = v && v.charAt(0) === '#' ? v : (v ? '#' + v : ''); },
    get href() { return 'https://randomstock.shop' + stack[idx].path + stack[idx].hash; }
  };
  const history = {
    scrollRestoration: 'auto',
    get state() { return stack[idx].state; },
    pushState(state, title, url) {
      const next = split(url);
      stack.splice(idx + 1);
      stack.push({ state, path: next.path, hash: next.hash });
      idx = stack.length - 1;
    },
    replaceState(state, title, url) {
      const next = split(url);
      stack[idx] = { state, path: next.path, hash: next.hash };
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

  const ctx = vm.createContext({
    window: win, document: doc, history, location,
    setTimeout, clearTimeout, console, IntersectionObserver: makeObserver()
  });
  new vm.Script(CODE, { filename: 'randomstock-listing.js' }).runInContext(ctx);

  const active = () => (((doc.querySelector('.page.active') || {}).dataset) || {}).view || '';
  return { win, doc, history, location, ctx, active, fire, getEl, pages };
}

(async function main() {
  const ev = (h, code) => vm.runInContext(code, h.ctx);
  const jordan = catalog.find((p) => p.id === 3);
  const href = '/product/' + slugs.productSlug(jordan) + '/';

  // ---- B1-B4: a shared link opens the pair, not the hero -------------------
  const B = boot(href, '', '../../');
  await sleep(320);
  ok('B1  a listing URL opens the product view', B.active() === 'product', B.active());
  ok('B2  and opens the pair that URL names', ev(B, 'current.id') === jordan.id, ev(B, 'current.id'));
  ok('B3  without rewriting the address it was served at',
    B.location.pathname === href && B.location.hash === '', B.location.pathname + B.location.hash);
  ok('B4  the title names the pair', B.doc.title === jordan.name + ' — Random Stock', B.doc.title);

  // ---- B5-B7: a card is a link, not a button -------------------------------
  // The card itself is links to the pair's page, never a button that pretends
  // to be one — that is what keeps ctrl-click, copy-link and open-in-new-tab
  // working. The one button a card now carries is the shortlist star, which is
  // not a way into the pair at all: it is a toggle with its own data-act, it
  // sits outside the photo/name/quick links (never nested inside one), and it
  // carries aria-pressed for its state. B6 therefore allows exactly that
  // button and nothing else, rather than none at all.
  const card = ev(B, 'productCard(products.find(p => p.id === 3))');
  ok('B5  the card links to that pair\'s page',
    card.indexOf('class="product-image" href="' + href + '"') >= 0 &&
    card.indexOf('class="name" href="' + href + '"') >= 0 &&
    card.indexOf('class="quick" href="' + href + '"') >= 0,
    card.replace(/\s+/g, ' ').slice(0, 200));
  ok('B6  the only button on the card is the shortlist star, outside the links',
    (card.match(/<button/g) || []).length === 1
      && /<button[^>]*class="save-btn"[^>]*data-act="toggleSave"/.test(card)
      && !/save-btn[^>]*data-product-link/.test(card),
    (card.match(/<button[^>]*>/g) || []).join(' '));
  ok('B7  every way into the pair is marked as one the page may take over',
    (card.match(/data-product-link/g) || []).length === 3,
    (card.match(/data-product-link/g) || []).length);

  // ---- B8: the photos still resolve from two directories down --------------
  ok('B8  the gallery asks for its photo through the stamped depth',
    B.getEl('gallery').innerHTML.indexOf('src="../../sneaker_images/') >= 0,
    (B.getEl('gallery').innerHTML.match(/src="[^"]*"/) || [''])[0]);

  // ---- B9-B11: plain click stays in the document, modified click does not ---
  const click = (h, mods) => {
    const link = {
      getAttribute: (n) => ({ 'data-act': 'openProduct', 'data-arg': '1' })[n] || null,
      hasAttribute: () => false
    };
    const event = Object.assign({
      target: { closest: (sel) => ((sel === '[data-act]' || sel === 'a[data-product-link]') ? link : null) },
      button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    }, mods || {});
    h.fire('document', 'click', event);
    return event;
  };

  const plain = click(B);
  await sleep(20);
  ok('B9  a plain click is taken over — no reload, and the pair opens',
    plain.defaultPrevented === true && B.active() === 'product',
    'prevented=' + plain.defaultPrevented + ' view=' + B.active());
  ok('B10 a plain click writes the clicked pair\'s own URL',
    B.location.pathname === '/product/' + slugs.productSlug(catalog.find((p) => p.id === 1)) + '/',
    B.location.pathname);

  const C = boot(href, '', '../../');
  await sleep(300);
  const modified = click(C, { ctrlKey: true });
  const middle = click(C, { button: 1 });
  ok('B11 ctrl-click and middle-click are left to the browser, so "new tab" reaches the page',
    modified.defaultPrevented === false && middle.defaultPrevented === false,
    'ctrl=' + modified.defaultPrevented + ' middle=' + middle.defaultPrevented);

  // ---- B12: leaving a listing page resets the path -------------------------
  // pushState('#shop') from /product/<slug>/ would stay on the listing URL, and a reload
  // there would reopen the pair instead of the shop.
  const D = boot(href, '', '../../');
  await sleep(300);
  ev(D, 'go("shop")');
  ok('B12 leaving a listing page for the shop lands on the root, not on the listing URL',
    D.location.pathname === '/' && D.location.hash === '#shop',
    D.location.pathname + D.location.hash);

  // ---- B13: the homepage draws the same link -------------------------------
  const E = boot('/', '', '');
  await sleep(300);
  const eCard = ev(E, 'productCard(products.find(p => p.id === 3))');
  ok('B13 the homepage card links to the same absolute product URL',
    eCard.indexOf('href="' + href + '"') >= 0, eCard.replace(/\s+/g, ' ').slice(0, 160));

  // ---- B14: the pair is the visible document's only top-level heading --------
  // `.page { display: none }` keeps every inactive view out of the accessibility tree, so
  // the pair's <h1> and the hero's <h1> never share an outline. The thing that would break
  // that is two views active at once, which no assertion here had ever looked at.
  const G = boot('/', '#home', '');
  await sleep(300);
  ev(G, 'openProduct(1)');
  const gDetails = ev(G, 'document.getElementById("details").innerHTML');
  const activeViews = ['home', 'shop', 'product', 'about'].filter((v) => G.pages[v]._classes.has('active'));
  ok('B14 a pair opened anywhere is the only visible <h1>',
    activeViews.length === 1 && activeViews[0] === 'product' &&
      (gDetails.match(/<h1[\s>]/g) || []).length === 1 &&
      G.location.pathname === '/product/' + slugs.productSlug(catalog.find((p) => p.id === 1)) + '/',
    'active=' + activeViews.join(',') + ' pair-h1s=' + (gDetails.match(/<h1[\s>]/g) || []).length +
      ' path=' + G.location.pathname);

  // ---- B15-B17: the homepage rails are curated, not catalog order ------------
  // JORDAN ROTATION used to be the first four Jordans in file order — Women's 6,
  // GS 3.5–6.5, an adult 8, Youth 4.5 — and MORE FROM THE VAULT was just the last
  // four rows, two Women's Dunks and two Yeezy Slides, while the marquee pairs
  // never appeared on the homepage at all. Both rails are now explicit ID lists
  // in renderHome, so a reordered or extended catalog cannot quietly swap them.
  // Boot renders the homepage at startup, so the stub's rail elements already
  // hold the cards; a card carries its listing id in data-arg.
  const railIds = (id) => {
    const html = G.getEl(id).innerHTML || '';
    // A card carries its listing id on three links (photo, name, quick view),
    // so dedupe in order — the rail is the sequence of distinct cards.
    const ids = (html.match(/data-arg="(\d+)"/g) || []).map((s) => Number(s.replace(/[^0-9]/g, '')));
    return ids.filter((v, i) => ids.indexOf(v) === i);
  };
  const trending = railIds('trending');
  const recent = railIds('recent');
  ok('B15  JORDAN ROTATION is the curated four, in order, all Jordan, all adult sizes',
    JSON.stringify(trending) === JSON.stringify([50, 52, 59, 56])
      && trending.every((id) => catalog.find((p) => p.id === id).brand.toLowerCase() === 'jordan'),
    JSON.stringify(trending));
  ok('B16  MORE FROM THE VAULT is the curated marquee four, not the last four rows',
    JSON.stringify(recent) === JSON.stringify([17, 69, 47, 44]),
    JSON.stringify(recent));
  ok('B17  neither rail still shows the old catalog-order openers',
    ![32, 33, 35, 99, 100, 101, 102].some((id) => trending.indexOf(id) >= 0 || recent.indexOf(id) >= 0),
    'trending=' + JSON.stringify(trending) + ' recent=' + JSON.stringify(recent));

  results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name +
    (r.pass ? '' : '   [' + r.extra + ']')));
  const failed = results.filter((r) => !r.pass).length;
  console.log('\nTOTAL=' + results.length + ' FAIL=' + failed);
  if (failed) process.exitCode = 1;
})();


