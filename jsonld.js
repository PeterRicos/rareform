// jsonld.js — the one place a listing becomes schema.org data.
//
// It has two consumers, which is the point. app.js writes a Product node for the
// view a shopper is actually on; build-jsonld.js bakes the whole catalog into
// index.html for crawlers and unfurlers that never run JavaScript. One builder
// means the live node and the baked-in one cannot disagree about a SKU, a photo or
// availability — and it is a plain function library, so it runs in the browser and
// in Node unchanged.
//
// Nothing here invents anything. Random Stock takes orders by phone and text and
// most listings carry no price, so an offer simply omits price unless products.js
// supplies one: add `price: 220` to a listing and it appears, in both places, with
// no other edit.
(function (root) {
  'use strict';

  const SITE_URL = 'https://randomstock.shop/';
  const STORE_NAME = 'Random Stock';
  // The store's number, in its three pieces — the same groups app.js assembles
  // (its note explains why a number is never written out whole here). The baked
  // catalog block in index.html omits it entirely, so the one file a scraper can
  // fetch without running JavaScript names no number: the live page builds it,
  // and the dialer and the runtime structured data still get it.
  const PHONE_GROUPS = ['914', '482', '1144'];
  const PHONE = '+1' + PHONE_GROUPS.join('');
  const PHONE_DISPLAY = '(' + PHONE_GROUPS[0] + ') ' +
    PHONE_GROUPS[1] + '-' + PHONE_GROUPS[2];

  // Photos and links must be absolute here: a crawler or an unfurler has no page
  // context to resolve "sneaker_images/square/foo.jpg" against.
  function absolute(src) {
    try {
      return new URL(src, SITE_URL).href;
    } catch (err) {
      return SITE_URL + String(src == null ? '' : src).replace(/^\/+/, '');
    }
  }

  // The catalog's canonical product URL. It is the /product/<slug>/ page
  // prerender-products.js writes, not the "#product/3" hash this used to name: the hash
  // was not an address, so every product advertised the homepage as its own URL and none
  // of them could be indexed separately. slugs.js holds the rule both this file and the
  // generator follow.
  //
  // The slugger is optional — without it (a harness that loads app.js alone, or a page
  // whose slugs.js failed) the old hash URL is still a working address on the live site,
  // so a missing file degrades instead of emitting "undefined" into the structured data.
  let slugger = null;
  function slugs() {
    if (slugger !== null) return slugger;
    try {
      slugger = (typeof module !== 'undefined' && module.exports)
        ? require('./slugs.js')
        : (root.RandomStockSlugs || false);
    } catch (err) {
      slugger = false;
    }
    return slugger;
  }

  function productUrl(listing) {
    const s = slugs();
    if (s && typeof s.productUrl === 'function') return s.productUrl(listing);
    return SITE_URL + '#product/' + listing.id;
  }

  // "New, original box" is what this catalog holds. The other two mappings are
  // here so that a used or refurbished listing is described rather than guessed at.
  function conditionUrl(condition) {
    const c = String(condition == null ? '' : condition).toLowerCase();
    if (c.indexOf('refurb') !== -1) return 'https://schema.org/RefurbishedCondition';
    if (c.indexOf('used') !== -1 || c.indexOf('pre-owned') !== -1) return 'https://schema.org/UsedCondition';
    return 'https://schema.org/NewCondition';
  }

  // Every photo of the listing, de-duplicated, absolute, in catalog order.
  function gallery(listing) {
    const shots = (listing.gallery && listing.gallery.length) ? listing.gallery : [listing.img];
    const urls = [];
    shots.forEach((src) => {
      if (!src) return;
      const url = absolute(src);
      if (urls.indexOf(url) === -1) urls.push(url);
    });
    return urls;
  }

  // A listing is stock we hold — the shop page removes what is gone rather than
  // marking it sold — so availability is a fact of being listed, not a guess.
  function offer(listing, options) {
    const brief = !!(options && options.brief);
    const node = {
      '@type': 'Offer',
      url: productUrl(listing),
      availability: 'https://schema.org/InStock',
      itemCondition: conditionUrl(listing.condition),
      // A reference, not a repeat of the store details on every one of 83 items.
      // `brief` and `phone: false` both reach the same reference: the first because the
      // catalog block repeats it 102 times, the second because the file is shipped.
      seller: (brief || (options && options.phone === false))
        ? { '@type': 'Organization', '@id': SITE_URL + '#store' }
        : { '@type': 'Organization', '@id': SITE_URL + '#store', name: STORE_NAME, telephone: PHONE }
    };
    if (typeof listing.price === 'number' && isFinite(listing.price)) {
      node.price = listing.price;
      node.priceCurrency = 'USD';
    }
    return node;
  }

  // The details the shop page prints in its meta block, so a crawler reads the same
  // colorway, packaging and size run a shopper does.
  function properties(listing) {
    const props = [];
    if (listing.box) props.push({ '@type': 'PropertyValue', name: 'Packaging', value: listing.box });
    if ((listing.sizes || []).length) {
      props.push({ '@type': 'PropertyValue', name: 'Sizes in stock', value: listing.sizes.join(', ') });
    }
    return props;
  }

  // Options:
  //   brief: true   lean node for the generated catalog block (name, brand, SKU, one
  //                 photo, availability) — it is repeated for every listing in the
  //                 page every visitor downloads, so it carries no more than that.
  //   variants:true one node per size, for a single product view where the sizes are
  //                 the answer to "do you have my size".
  //   phone: false  leave the telephone off the offer. For the blocks a build script
  //                 writes into the repo (the catalog in index.html, the product node in
  //                 each prerendered listing page): those files are what a scraper reads
  //                 without running anything, so they name no number — the live page
  //                 still builds its node with it, exactly as organization() does.
  function product(listing, options) {
    const opts = options || {};
    const sizes = listing.sizes || [];
    const node = {
      '@type': 'Product',
      '@id': productUrl(listing),
      url: productUrl(listing),
      name: listing.name,
      sku: listing.sku,
      brand: { '@type': 'Brand', name: listing.brand },
      image: opts.brief ? gallery(listing).slice(0, 1) : gallery(listing),
      itemCondition: conditionUrl(listing.condition),
      offers: offer(listing, opts)
    };

    if (!opts.brief) {
      node.mpn = listing.sku;
      if (listing.color) node.color = listing.color;
      if (listing.category) node.category = listing.category;
      const props = properties(listing);
      if (props.length) node.additionalProperty = props;
    }

    if (opts.variants && sizes.length) {
      node.hasVariant = sizes.map((size) => ({
        '@type': 'Product',
        name: listing.name + ' — size ' + size,
        sku: listing.sku + '-' + String(size).replace(/\s+/g, ''),
        size: size,
        offers: offer(listing, opts)
      }));
    }

    return node;
  }

  function organization(options) {
    const node = {
      '@type': 'Organization',
      '@id': SITE_URL + '#store',
      name: STORE_NAME,
      url: SITE_URL,
      image: absolute('og-image.jpg'),
      description: 'A small, hand-checked sneaker inventory. Every pair is inspected by hand before it ships.'
    };
    // Baked into index.html the phone comes off on purpose: the markup is what a
    // scraper can read without running anything (see the note near PHONE). The
    // live product node — built by the page, where the dialer links are too —
    // still carries it.
    if (!options || options.phone !== false) node.telephone = PHONE;
    return node;
  }

  // The whole catalog as one ItemList, with the store node the offers reference.
  function catalog(listings) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        organization({ phone: false }),
        {
          '@type': 'ItemList',
          '@id': SITE_URL + '#catalog',
          name: STORE_NAME + ' catalog',
          numberOfItems: listings.length,
          itemListElement: listings.map((listing, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: product(listing, { brief: true })
          }))
        }
      ]
    };
  }

  // Single line on purpose: this text lands inside index.html, which every visitor
  // downloads, and JSON of the whole catalog indented would triple it. `<` is
  // escaped because that block is parsed as HTML: a listing name containing
  // "</script" would otherwise close the tag. "\u003c" is the same character to
  // every JSON parser, so nothing is lost.
  function stringify(node) {
    return JSON.stringify(node).replace(/</g, '\\u003c');
  }

  const api = {
    SITE_URL: SITE_URL,
    STORE_NAME: STORE_NAME,
    PHONE: PHONE,
    PHONE_DISPLAY: PHONE_DISPLAY,
    PHONE_GROUPS: PHONE_GROUPS,
    absolute: absolute,
    productUrl: productUrl,
    conditionUrl: conditionUrl,
    gallery: gallery,
    product: product,
    organization: organization,
    catalog: catalog,
    stringify: stringify
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.structuredData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);