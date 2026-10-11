// build-jsonld.js — writes the catalog's schema.org block into index.html.
//
// Run: node build-jsonld.js     (idempotent — safe to run at any time)
//
// Why a build step: index.html is the only URL a crawler or an unfurler fetches, and
// the catalog reaches it from products.js through JavaScript — which unfurlers never
// run, and not every crawler does. Writing the same listings into the page as JSON-LD
// puts the products, their SKUs, photos and availability in the HTML itself, so
// something that only reads markup still sees 83 products rather than an empty shell.
//
// The data comes from products.js through jsonld.js — the same builder the live page
// uses for the product view — so the baked-in copy and the runtime one cannot drift.
// .github/workflows/stamp-assets.yml runs this on every push to main, next to the
// asset stamping, so a listing edit can never leave stale structured data behind.
//
// Safe to delete: without it, index.html keeps whatever block was written last and
// nothing else changes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const structuredData = require('./jsonld.js');

const PAGE = path.join(__dirname, 'index.html');
const CATALOG = path.join(__dirname, 'products.js');
const BEGIN = '<!-- catalog-jsonld:begin -->';
const END = '<!-- catalog-jsonld:end -->';

// products.js is a browser script — `const localProducts = [...]` plus a
// window.localProducts hand-off — so it cannot be required. Running it in a sandbox
// with a stub window is the honest way to read the very array the page gets: no
// regex over a JS literal, no second copy of the catalog to fall out of step.
function readCatalog() {
  const source = fs.readFileSync(CATALOG, 'utf8');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;window.__catalog = localProducts;', sandbox, { filename: 'products.js' });
  const listings = sandbox.window.__catalog;
  if (!Array.isArray(listings) || !listings.length) {
    throw new Error('products.js did not expose a non-empty localProducts array');
  }
  return listings;
}

const page = fs.readFileSync(PAGE, 'utf8');
const start = page.indexOf(BEGIN);
const end = page.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  console.error('index.html has no ' + BEGIN + ' … ' + END + ' pair; nothing written');
  process.exit(1);
}

const listings = readCatalog();
const json = structuredData.stringify(structuredData.catalog(listings));
JSON.parse(json);   // a broken block should fail here, not in a crawler

const block = BEGIN + '\n  <script type="application/ld+json">' + json + '</script>\n  ' + END;
const after = page.slice(0, start) + block + page.slice(end + END.length);

if (after === page) {
  console.log('catalog-jsonld items=' + listings.length + ' rewritten=no (already current)');
} else {
  fs.writeFileSync(PAGE, after);
  console.log('catalog-jsonld items=' + listings.length + ' bytes=' + json.length + ' rewritten=yes');
}