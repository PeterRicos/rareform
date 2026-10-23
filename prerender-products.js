// prerender-products.js — writes one real page per listing: /product/<slug>/index.html.
//
// Run: node prerender-products.js     (idempotent — safe to run at any time)
//
// Why a build step: nothing on this site had an address of its own. Every pair was
// drawn by app.js into index.html and linked as "#product/3", so all 102 listings
// shared one URL — a crawler had one page to index, a shared link opened the homepage,
// and ctrl-click on a card did nothing. The fix is a directory per pair; this writes it.
//
// Each page is index.html with the listing folded in:
//   - its own <title>, description, canonical, Open Graph and Twitter tags, so a link
//     to a pair unfurls as that pair;
//   - its own Product JSON-LD (through jsonld.js, the same builder the page uses), so
//     the structured data cannot describe a different product from the markup;
//   - the product view already filled in and already active, so the name, SKU,
//     condition and sizes are readable with no JavaScript at all;
//   - the hero clip dropped and the hidden home view's photos deferred — a listing page
//     has no business downloading 1.7 MB of homepage decoration;
//   - every relative asset path made root-absolute, because these files sit two
//     directories down.
//
// app.js then boots and re-renders the same pair over the top, so a shopper with
// JavaScript gets the interactive page (size buttons, dialer, QR) and a crawler or a
// reader with scripting off still gets the facts. Nothing in the generated markup is a
// dead control: the sizes are text, not buttons that do nothing without a script.
//
// The files are committed. A deploy here is a static host with no build step, so this
// must be run (and its output pushed) whenever products.js changes;
// .github/workflows/stamp-assets.yml does exactly that on every push to main.
//
// Safe to delete: without it, the pages it already wrote stay as they are and the
// homepage still works — it just loses the per-pair URLs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const slugs = require('./slugs.js');
const structuredData = require('./jsonld.js');

const PAGE = path.join(__dirname, 'index.html');
const CATALOG = path.join(__dirname, 'products.js');
const OUT_DIR = path.join(__dirname, 'product');
const SITE_URL = structuredData.SITE_URL;
const BEGIN = '<!-- catalog-jsonld:begin -->';
const END = '<!-- catalog-jsonld:end -->';

// products.js is a browser script (`const localProducts = [...]` plus a
// window.localProducts hand-off), so it cannot be required. Running it in a sandbox with
// a stub window reads the very array the page gets — the same approach build-jsonld.js
// takes, and the reason the two generated artefacts cannot disagree with the shop.
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

// Everything below writes catalog strings into HTML, so they are escaped on the way in:
// a listing renamed "Nike Dunk <Black>" must render as text, not as a tag.
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A description long enough to say something, short enough not to be cut in the
// results: Google truncates around 160 characters, and a snippet ending in "…" reads
// like a broken page. Built from what the catalog actually knows, then trimmed at a
// word boundary rather than mid-word.
function descriptionFor(p) {
  const sizes = (p.sizes || []).join(', ');
  const parts = [
    p.name + (p.color ? ' in ' + p.color : '') + '.',
    [p.condition, p.box].filter(Boolean).join(', ') + '.',
    sizes ? 'Sizes held: ' + sizes + '.' : '',
    'Hand-checked and authentic. No cart — call or text to claim it and confirm the price.'
  ];
  const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157);
  const space = cut.lastIndexOf(' ');
  return (space > 100 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, '') + '.';
}

// The product's own structured data. No telephone on either node: this file is what a
// scraper reads without running anything. The live page builds the same nodes with the
// number in them (test-privacy.js pins both halves of that).
function jsonLdFor(p) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      structuredData.organization({ phone: false }),
      structuredData.product(p, { phone: false }),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_URL + '#shop' },
          { '@type': 'ListItem', position: 3, name: p.name, item: structuredData.productUrl(p) }
        ]
      }
    ]
  };
}

// The two halves of the product view, written as the page would have drawn them — minus
// anything that needs a script. app.js replaces both on boot.
//
// Sizes are a line of text, not the shop's size buttons: a button that cannot select
// anything is worse than a sentence, and this markup is what a reader with scripting off
// is left with.
function staticGallery(p) {
  const shots = (p.gallery && p.gallery.length) ? p.gallery : [p.img];
  return shots.map((src, i) => `
          <div class="gallery-shot">
            <img src="/${esc(src).replace(/^\/+/, '')}" alt="${esc(p.name)}${shots.length > 1 ? ' angle ' + (i + 1) : ''}" width="600" height="600" decoding="async">
          </div>`).join('');
}

function staticDetails(p) {
  const sizes = (p.sizes || []).join(', ');
  return `
        <span class="eyebrow">${esc(p.brand)}</span>
        <h1>${esc(p.name)}</h1>
        <p class="color" style="font-size:14px;color:var(--muted);margin:4px 0 16px">${esc(p.color)}</p>
        <div class="meta">
          SKU: ${esc(p.sku)}<br>
          CONDITION: ${esc(p.condition)}<br>
          PACKAGING: ${esc(p.box || 'Original Box')}<br>
          ${sizes ? 'SIZES HELD: ' + esc(sizes) + '<br>' : ''}
          PRICE: ON REQUEST — ASK US
        </div>
        <p class="order-note">Call or text about this pair and we will confirm the price, availability, condition and shipping.</p>
        <noscript><p class="order-note">The call and text buttons on this page need JavaScript. Turn it on and reload to claim this pair.</p></noscript>
        <div class="perks">
          <p>✓ <b>100% Authenticity Guaranteed:</b> Hand-inspected by verification specialists.</p>
          <p>✓ <b>Insured Express Shipping:</b> Ships double-boxed with tracking in 1-2 business days.</p>
          <p>✓ <b>Buyer Protection:</b> Full refund if authenticity does not meet our standard.</p>
        </div>`;
}

// index.html is edited by hand and by three scripts, so a page shape this generator no
// longer recognises has to stop the build rather than quietly ship a listing page with
// an empty product view.
function replaceOnce(html, needle, replacement, label) {
  if (html.indexOf(needle) === -1) {
    throw new Error('index.html no longer contains ' + label +
      ' — prerender-products.js and the page have drifted; fix this before shipping');
  }
  return html.replace(needle, () => replacement);
}

// One head meta, by property/name, whatever its current value.
function setMeta(html, kind, key, value) {
  const re = new RegExp('(<meta ' + kind + '="' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '") content="[^"]*"');
  if (!re.test(html)) throw new Error('index.html has no <meta ' + kind + '="' + key + '">');
  return html.replace(re, (whole, attr) => attr + ' content="' + esc(value) + '"');
}

// Every relative path made root-absolute. The generated pages sit two directories down,
// so "styles.css" there means /product/<slug>/styles.css — a 404 for the stylesheet, the
// scripts, the icons and the photos. Absolute paths resolve the same from any depth,
// which is also why the injected markup above already writes them that way.
function absolutise(html) {
  // Only attribute values, and only ones that are actually relative: a hash route, a
  // tel:/mailto: link and an absolute URL must all be left exactly as they are.
  let out = html.replace(/(\s)(src|href)="(?!https?:|\/\/|\/|#|data:|mailto:|tel:|sms:)([^"]*)"/g,
    (whole, space, attr, value) => space + attr + '="/' + value + '"');
  // srcset holds a comma-separated list of "url width" pairs, so it needs its own pass.
  out = out.replace(/(\s)srcset="([^"]*)"/g, (whole, space, value) => {
    const list = value.split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      const url = bits.shift();
      if (!url || /^(https?:)?\/\//.test(url) || url.charAt(0) === '/') return part.trim();
      return ['/' + url].concat(bits).join(' ');
    });
    return space + 'srcset="' + list.join(', ') + '"';
  });
  return out;
}

// One listing page, from the homepage.
function buildPage(page, p) {
  const url = structuredData.productUrl(p);
  const title = p.name + (p.sku ? ' ' + p.sku : '') + ' — Random Stock';
  const description = descriptionFor(p);
  const image = structuredData.absolute(p.img);

  // The catalog stores photos relative to the site root; this is the depth they resolve
  // from here, and app.js reads it back off <html> (see ASSET_BASE there).
  let html = replaceOnce(page, '<html lang="en">',
    '<html lang="en" data-asset-base="../../">', 'the <html> tag');

  html = replaceOnce(html, '<link rel="canonical" href="https://randomstock.shop/">',
    '<link rel="canonical" href="' + url + '">', 'the canonical link');
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:type', 'product');
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:image', image);
  // The catalog's photos are 600px squares; the homepage card's 1200x630 does not
  // describe them, and an unfurler told the wrong size crops what it does show.
  html = setMeta(html, 'property', 'og:image:width', '600');
  html = setMeta(html, 'property', 'og:image:height', '600');
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  html = setMeta(html, 'name', 'twitter:image', image);

  if (!/<title>[^<]*<\/title>/.test(html)) throw new Error('index.html has no <title>');
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>');

  // The catalog block describes 102 listings; this page is about one of them.
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  if (start === -1 || end < start) throw new Error('index.html has no ' + BEGIN + ' … ' + END + ' pair');
  const block = '<!-- product-jsonld: one listing, written by prerender-products.js -->\n' +
    '  <script type="application/ld+json">' + structuredData.stringify(jsonLdFor(p)) + '</script>\n  ';
  html = html.slice(0, start) + block + html.slice(end + END.length);

  // The page was served for this pair, so this pair is the view it shows — with or
  // without the script that would otherwise switch it on.
  html = replaceOnce(html, '<div id="view-home" data-view="home" class="page active">',
    '<div id="view-home" data-view="home" class="page">', 'the active home view');
  html = replaceOnce(html, '<div id="view-product" data-view="product" class="page">',
    '<div id="view-product" data-view="product" class="page active">', 'the inactive product view');

  html = replaceOnce(html, '<div class="gallery" id="gallery"></div>',
    '<div class="gallery" id="gallery">' + staticGallery(p) + '\n        </div>', 'the empty gallery');
  html = replaceOnce(html, '<div class="details" id="details"></div>',
    '<div class="details" id="details">' + staticDetails(p) + '\n        </div>', 'the empty details');
  html = replaceOnce(html, '<span id="breadcrumbProduct"></span>',
    '<span id="breadcrumbProduct">' + esc(p.name) + '</span>', 'the breadcrumb slot');

  // The hero belongs to the homepage. Its clip is 1.7 MB and its photo is the largest
  // image on the site; neither is worth a byte on a page that shows neither.
  const hero = /<!-- hero-video:begin[\s\S]*?<!-- hero-video:end -->/;
  if (!hero.test(html)) throw new Error('index.html has no hero-video marker pair');
  html = html.replace(hero, '<!-- No clip and no eager photo here: the home view is hidden on a\n' +
    '             listing page, and the clip alone is 1.7 MB this page has no use for. -->');
  html = html.replace('decoding="async" fetchpriority="high"', 'decoding="async" loading="lazy"');

  return absolutise(html);
}

// The sitemap was a single homepage entry because that was the only URL a crawler could
// reach. Now there is one per pair, so it lists them — and each entry carries the photo
// its own page shows, because image search is how a pair gets found by someone who does
// not yet know its name. test-product-pages.js proves every <image:loc> resolves to a
// real file: an image sitemap pointing at 404s is worse than no image sitemap.
//
// No <lastmod>: the honest value is "when this listing last changed", which the files do
// not record. A build-time "today" would rewrite the sitemap on every run, put a changed
// date on all 103 entries in every commit, and teach a crawler to ignore the field —
// worse than its absence.
function imageEntry(p) {
  const src = String((p && p.img) || '').replace(/^\/+/, '');
  if (!src) return '';
  // encodeURI covers the spaces a photo arrives with; # and ? would otherwise pass
  // through and silently truncate the URL, so they are escaped here as well.
  const loc = SITE_URL + encodeURI(src).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const title = String((p && p.name) || '').trim();
  return [
    '    <image:image>',
    '      <image:loc>' + esc(loc) + '</image:loc>',
    title ? '      <image:title>' + esc(title) + '</image:title>' : '',
    '    </image:image>'
  ].filter(Boolean).join('\n');
}

function sitemapFor(listings) {
  const pages = listings.map((p) => ({
    loc: structuredData.productUrl(p),
    image: imageEntry(p)
  }));
  const entries = [{ loc: SITE_URL, image: '' }].concat(pages).map((e, i) => [
    '  <url>',
    '    <loc>' + e.loc + '</loc>',
    '    <changefreq>weekly</changefreq>',
    '    <priority>' + (i === 0 ? '1.0' : '0.8') + '</priority>',
    e.image,
    '  </url>'
  ].filter(Boolean).join('\n')).join('\n');
  const hasImages = pages.some((e) => e.image);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- Written by prerender-products.js: the homepage, one URL per listing, and the\n' +
    '     photo each listing page shows. -->\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
    (hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '') +
    '>\n' + entries + '\n</urlset>\n';
}

function main() {
  const page = fs.readFileSync(PAGE, 'utf8');
  const listings = readCatalog();

  // A duplicate slug would have two listings overwrite each other's page, and the one
  // that won would be the last in the file. Loud on the way in, not silent on the site.
  const seen = new Map();
  listings.forEach((p) => {
    const slug = slugs.productSlug(p);
    if (seen.has(slug)) {
      throw new Error('duplicate slug "' + slug + '" for listings ' + seen.get(slug) + ' and ' + p.id +
        ' — give one of them a distinct name or SKU');
    }
    seen.set(slug, p.id);
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const keep = new Set();
  let written = 0;
  let unchanged = 0;

  listings.forEach((p) => {
    const slug = slugs.productSlug(p);
    const dir = path.join(OUT_DIR, slug);
    const file = path.join(dir, 'index.html');
    const html = buildPage(page, p);
    keep.add(slug);
    fs.mkdirSync(dir, { recursive: true });
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before === html) {
      unchanged += 1;
      return;
    }
    fs.writeFileSync(file, html);
    written += 1;
  });

  // A listing that left the catalog must not leave its page behind: a shopper would
  // reach a pair the shop no longer has, and it would stay indexed.
  let pruned = 0;
  fs.readdirSync(OUT_DIR, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isDirectory() || keep.has(entry.name)) return;
    fs.rmSync(path.join(OUT_DIR, entry.name), { recursive: true, force: true });
    pruned += 1;
  });

  const sitemapPath = path.join(__dirname, 'sitemap.xml');
  const sitemap = sitemapFor(listings);
  const sitemapBefore = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : null;
  if (sitemapBefore !== sitemap) fs.writeFileSync(sitemapPath, sitemap);

  console.log('prerendered listings=' + listings.length +
    ' written=' + written +
    ' unchanged=' + unchanged +
    ' pruned=' + pruned +
    ' sitemap=' + (sitemapBefore !== sitemap ? 'rewritten' : 'current'));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('prerender-products: ' + err.message);
    process.exit(1);
  }
}

module.exports = { readCatalog, descriptionFor, jsonLdFor, buildPage, sitemapFor, esc };
