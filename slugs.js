// slugs.js — the one rule that turns a listing into its address.
//
// A pair used to live at "#product/3", which is not an address: every product shared
// the homepage URL, so nothing could be indexed, linked or shared as a page of its own.
// Each listing now has /product/<slug>/ and this file is where that slug is decided.
//
// It has three consumers, which is the point — app.js draws the links, jsonld.js
// advertises them as the product's canonical URL, and prerender-products.js creates the
// folders. One rule means a link drawn on the card, the URL a crawler reads and the
// directory on disk cannot disagree: change it here and all three move together.
//
// Plain function library, no DOM, no Node built-ins: it loads as a <script> in the page
// and through require() in the build scripts, unchanged.
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  // `window` first, not globalThis: the page reads this as window.RandomStockSlugs, and
  // in a script the two are the same object in a browser but not under a bare vm
  // context, where globalThis is the sandbox and window is one of its properties.
  else root.RandomStockSlugs = factory();
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this),
function () {
  'use strict';

  // The name part is capped so a long listing does not build a path near the 255-byte
  // file-name limit once the SKU is appended, and so a link stays short enough to paste
  // into a message. The SKU is never cut: it is what keeps the slug unique.
  const MAX_SLUG_CHARS = 80;

  // Lowercase ASCII, words joined by single hyphens: "WMNS Travis Scott Air Force 1
  // White/White" → "wmns-travis-scott-air-force-1-white-white". The slash, the spaces
  // and the accents all have to go — a URL with any of them has to be percent-encoded,
  // which is exactly the kind of link that gets mangled when it is pasted into a DM.
  function slugify(text) {
    return String(text == null ? '' : text)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')      // "Café" → "Cafe", not "caf"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // The SKU is what makes the slug unique and stable. The name alone is neither: two
  // colorways can read the same, and renaming a listing would silently move its page.
  // Appending the SKU also means /product/<slug>/ still names the same pair after the
  // title is edited — the old folder is the only thing that has to be regenerated.
  function productSlug(product) {
    const p = product || {};
    const sku = slugify(p.sku);
    const tail = sku || (p.id != null ? 'id-' + p.id : '');
    const room = Math.max(0, MAX_SLUG_CHARS - (tail ? tail.length + 1 : 0));
    const name = slugify(p.name).slice(0, room).replace(/-+$/, '');
    if (name && tail) return name + '-' + tail;
    return name || tail || 'listing';
  }

  // Root-relative on purpose: it resolves the same from "/" and from inside a listing
  // page, so a card on one product page can link to the next without recomputing depth.
  function productPath(product) {
    return '/product/' + productSlug(product) + '/';
  }

  // The canonical absolute URL, which is what structured data and the sitemap need.
  const SITE_URL = 'https://randomstock.shop/';
  function productUrl(product) {
    return SITE_URL + 'product/' + productSlug(product) + '/';
  }

  return {
    slugify: slugify,
    productSlug: productSlug,
    productPath: productPath,
    productUrl: productUrl,
    SITE_URL: SITE_URL
  };
});
