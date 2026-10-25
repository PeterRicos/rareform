// Random Stock store logic (rendering, router, search, filters, dialogs).
// Loaded AFTER products.js — the catalog array arrives via window.localProducts.
// No markup lives here; index.html holds the page structure only.

const products = [];
const moreProducts = [];
products.push(...moreProducts);
products.push(...(window.localProducts || []));

// ---- Product addresses ------------------------------------------------------
//
// A pair is reachable at /product/<slug>/ — a real page, prerendered from this catalog
// by prerender-products.js. slugs.js owns the slug rule; it is read defensively because
// app.js must still run where it was not loaded (a harness booting products.js + app.js
// alone, or a page whose slug file failed), and there the hash routes below are the
// only addresses that exist.
const slugger = (typeof window !== 'undefined' && window.RandomStockSlugs) || null;

// The catalog stores every photo as a path from the site root ("sneaker_images/…").
// That is the right thing to store, but it only resolves on a page served from the
// root: from /product/<slug>/ the browser would ask for
// /product/<slug>/sneaker_images/… and get a 404 — which is what a card grid or a
// gallery drawn on a listing page would do. The generator stamps the depth it wrote on
// <html data-asset-base>, and every catalog path goes through assetURL().
const ASSET_BASE = (document.documentElement &&
  document.documentElement.getAttribute('data-asset-base')) || '';

function assetURL(src) {
  const s = String(src == null ? '' : src);
  if (!s) return s;
  if (s.charAt(0) === '/' || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') === 0) return s;
  return ASSET_BASE + s;
}

function productSlugOf(p) {
  return (slugger && p) ? slugger.productSlug(p) : '';
}

// The href a card points at. Without the slugger there is no page to point at, so the
// hash route is named instead — the same URL this site used before, which still works.
function productHref(p) {
  if (p && slugger) return '/product/' + productSlugOf(p) + '/';
  return '#product/' + (p ? p.id : '');
}

// Is this document itself a prerendered listing page? Used to decide whether a link to
// another view has to reset the path to "/" (see urlFor).
function onProductPath() {
  return typeof location !== 'undefined' &&
    /^\/product\/[^/]+\/?$/.test(location.pathname || '');
}

// The listing this document was served for, or null on the homepage.
function pathProduct() {
  if (!onProductPath() || !slugger) return null;
  const slug = decodeURIComponent((location.pathname || '').replace(/^\/product\//, '').replace(/\/.*$/, ''));
  return products.find(p => productSlugOf(p) === slug) || null;
}

// The identity of the current history entry. A listing lives at a path and every other
// view in the hash, so the two together are what "already on that URL" means here.
// (Comparing location.hash alone would read every listing page as "#home".)
function urlKey() {
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  const hash = (typeof location !== 'undefined' && location.hash) || '';
  return path + hash;
}

// State Management
    let current = products[0];
    let selectedSize = null;
    let galleryList = [];   // photos of `current`, in the order the gallery draws them
    let zoomIndex = 0;      // which of them the zoom viewer is showing
    let shopRendered = false;   // has the shop grid been mounted yet? (see showPage)

    const $ = id => document.getElementById(id);

    // ---- Cleanup pass helpers ----

    // Catalog sizes mix men's, women's and youth shoe runs ("10", "5.5W", "2Y",
    // "13K") with apparel letters ("S", "M", "L") and fitted-hat fractions
    // ("7 1/4"). Nothing else in the catalog reads like a bare letter or a spaced
    // fraction, so both are unambiguous and get groups of their own instead of being
    // passed off as men's shoe sizes.
    //
    // A bare number is the one string that cannot say which run it belongs to: "7"
    // is a men's shoe size in this catalog and also a real fitted-cap size, so a
    // listing that holds 7 next to 7 1/8 read as two runs at once and the detail
    // page called it "Mixed sizing". The listing itself declares the answer —
    // `sizeGroup` in products.js — and it wins when it is there.
    function sizeCategory(size, group) {
      if (group) return group;
      const s = String(size || '').trim().toUpperCase();
      if (/^\d+\s+\d+\/\d+/.test(s)) return 'Headwear';
      if (/^[A-Z]+$/.test(s)) return 'Apparel';
      if (/W$/.test(s)) return 'Women';
      if (/[YKC]$/.test(s)) return 'Youth';
      return 'Men';
    }

    // How a single size reads to customers: shoe sizes carry "US", apparel letters and
    // hat fractions are already self-explanatory. Used by the filter dropdown, the size
    // chips, and the order message, so a hoodie can never again read as "US M".
    function sizeDisplay(s, group) {
      const cat = sizeCategory(s, group);
      return (cat === 'Apparel' || cat === 'Headwear') ? String(s) : 'US ' + s;
    }

    // Detail-page sizing line — "US" only belongs in front of shoe runs.
    const SIZING_LABELS = {
      Men: "US Men's sizing",
      Women: "US Women's sizing",
      Youth: 'US Youth sizing',
      Apparel: 'Apparel sizing',
      Headwear: 'Headwear sizing'
    };

    function sizeCategoryLabel(product) {
      const cats = uniqSorted((product && product.sizes ? product.sizes : [])
        .map(s => sizeCategory(s, product.sizeGroup)));
      if (!cats.length) return '';
      if (cats.length > 1) return 'Mixed sizing';
      return SIZING_LABELS[cats[0]] || 'Sizing';
    }

    // The color line under a name usually restates it ("Onyx" under a title that
    // already ends in Onyx), so it only prints when the name does not already
    // contain the colorway. Parenthetical tags ("(Women's)", "(GS)") are not part
    // of the colorway, so they are stripped before comparing.
    function colorRepeatsName(product) {
      const color = String((product && product.color) || '').replace(/\([^)]*\)/g, '').trim().toLowerCase();
      const name = String((product && product.name) || '').toLowerCase();
      return !!color && name.indexOf(color) >= 0;
    }

    // The shop answers orders by phone or text; this is the number, written once.
    //
    // Its digits are kept in three pieces and joined here rather than written out
    // whole: this file ships to every visitor and the repo is public, so a number
    // sitting in the source is a number a scraper pulls with one regex. Nothing
    // here makes it secret — the page has to hand a real number to the dialer, so
    // anyone who renders it can read it off the links — but printing it nowhere
    // means harvesting the repo or the raw HTML takes a browser and a parser, not
    // `grep`. Keep the pieces in order; jsonld.js holds the same three groups
    // (the two files never load together in the harnesses, so neither can read the
    // other, and test-privacy.js verifies the copies agree).
    const ORDER_PHONE_GROUPS = ['914', '482', '1144'];
    const ORDER_PHONE = '+1' + ORDER_PHONE_GROUPS.join('');
    const ORDER_PHONE_DISPLAY = '(' + ORDER_PHONE_GROUPS[0] + ') ' +
      ORDER_PHONE_GROUPS[1] + '-' + ORDER_PHONE_GROUPS[2];

    // One sentence identifies a pair, so it is written once: the detail page's order
    // links, the desktop order dialog and its QR code all build their message from
    // it, and every one of them names the same SKU and size.
    function orderSummary() {
      if (!current) return '';
      const size = selectedSize || (current.sizes || [])[0] || '';
      return current.name + ' (SKU ' + current.sku + ')' + (size ? ', size ' + sizeDisplay(size, current.sizeGroup) : '');
    }

    // '?&body=' is the iOS/Android compromise: iOS wants "&body=", Android wants
    // "?body=", and both tolerate the pair.
    function smsHref(message) {
      return 'sms:' + ORDER_PHONE + (message ? '?&body=' + encodeURIComponent(message) : '');
    }

    function defaultOrderMessage() {
      const summary = orderSummary();
      return summary ? 'Hi Random Stock, is the ' + summary + ' still available?' : '';
    }

    // The size chips report what we hold; these links carry the pair and the chosen
    // size into the message so nobody has to retype a SKU.
    function updateOrderLinks() {
      const call = $('orderCall');
      const text = $('orderText');
      if (!call || !text || !current) return;
      call.href = 'tel:' + ORDER_PHONE;
      text.href = smsHref(defaultOrderMessage());
      updateListingQr();
    }

    // The catalog has a name with an "&" in it (the Bearbrick "... 100% & 400% Set
    // Multicolor"), and the note below prints the order sentence, so the sentence is
    // escaped on the way into the markup rather than trusted to be markup-safe.
    function esc(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // The code that sits in the listing itself. A desktop has nowhere to put an sms:
    // link — the click lands on nothing and the shopper is invited to text a number
    // from a laptop — so the listing carries the message as a code their phone can
    // scan, with nothing having to be clicked first. It is built from the same sentence
    // as the Text button above it (defaultOrderMessage), so the pair, the SKU and
    // whichever size is selected are already in the message when Messages opens.
    //
    // Only the code has to be kept current here. Whether the block is shown at all is a
    // pointer question answered in styles.css (.listing-qr): on a phone, which can tap
    // the button above and cannot scan its own screen, it never appears.
    //
    // 4px per module, so the code is 228-260px wide depending on how long the item's
    // sentence is: that is the size both decoders still read after the code is captured
    // smaller than it is drawn, and it is what the block is laid out around.
    const LISTING_QR_MODULE_PX = 4;

    function updateListingQr() {
      const box = $('listingQr');
      if (!box || !current) return;
      const message = defaultOrderMessage();
      box.innerHTML =
        '<div class="listing-qr-code">' +
          qrSvg(smsHref(message), 'QR code that opens a text to ' + ORDER_PHONE_DISPLAY +
            ' about ' + esc(orderSummary()), true, LISTING_QR_MODULE_PX) +
        '</div>' +
        '<div class="listing-qr-note">' +
          '<b>On a computer?</b> Scan the code with your phone camera — it opens a text to ' +
          ORDER_PHONE_DISPLAY + ' with this already written in:' +
          '<span class="listing-qr-message">' + esc(message) + '</span>' +
        '</div>';
    }

    // Dialogs: keep Tab inside the open drawer/modal and hand focus back on close.
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let activeTrap = null;
    let focusBeforeTrap = null;

    function trapKeydown(e) {
      if (e.key !== 'Tab' || !activeTrap) return;
      const items = Array.prototype.filter.call(activeTrap.querySelectorAll(FOCUSABLE), el => el.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    function trapFocus(container) {
      if (!container) return;
      releaseFocus(false);
      activeTrap = container;
      focusBeforeTrap = document.activeElement;
      container.addEventListener('keydown', trapKeydown);
    }

    function releaseFocus(restore) {
      if (activeTrap) {
        activeTrap.removeEventListener('keydown', trapKeydown);
        activeTrap = null;
      }
      if (restore !== false && focusBeforeTrap && focusBeforeTrap.focus) focusBeforeTrap.focus();
      focusBeforeTrap = null;
    }

    // Smooth scrolling is a motion effect, so it follows the OS preference.
    const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function scrollBehavior() {
      return reduceMotionQuery && reduceMotionQuery.matches ? 'auto' : 'smooth';
    }

    // Listings default to sneakers; Supreme is clothing; anything else sets `category`.
    function productCategory(p) {
      return p.category || (p.brand.toLowerCase() === 'supreme' ? 'clothing' : 'sneakers');
    }
    // The hero's own SHOP SNEAKERS tile routes here with 'sneakers', so a shopper
    // coming back from Clothing or Random Shit lands on every pair in the catalog,
    // not on whatever category their last visit left on the shop.
    const CATEGORY_TITLES = { sneakers: 'SNEAKERS', clothing: 'CLOTHING & ACCESSORIES', random: 'RANDOM SHIT' };
    let shopCategoryFilter = '';

    // Product Card Template
    //
    // `sizeQuery` is the size search this grid is answering, when there is one. A card
    // normally prints the pair's run — "US 7 · 8 · 9 · 11" on a Jordan 11 — which reads
    // as a broken search the moment somebody types 11 and the first thing under the
    // photo is a 7. Under a size query the line lists only the sizes that answered it,
    // so "11" shows "US 11 · 11.5", exactly as asked for. Callers hand it over
    // explicitly: a bare `.map(productCard)` would pass the array index in its place.
    function productCard(p, sizeQuery) {
      const isSneaker = productCategory(p) === 'sneakers';
      const buttonText = isSneaker ? 'VIEW PAIR' : 'VIEW ITEM';
      const held = sizeQuery ? matchingSizes(p, sizeQuery) : (p.sizes || []).slice();
      const shown = sizeQuery ? held : held.slice(0, 4);
      const sizeLine = shown.length
        ? shown.map(s => sizeDisplay(s, p.sizeGroup)).join(' · ') + (held.length > shown.length ? ' · +' : '')
        : '';
      // Sneakers are the ones whose run is worth printing unasked; a size query prints
      // whatever answered it, clothing included ("M" is the answer to typing m).
      const sizeText = (isSneaker || sizeQuery) ? sizeLine : '';
      // Every way into a pair is a real link to that pair's own page. The href is what
      // a crawler follows, what a "copy link" gives, and what ctrl/cmd-click opens in a
      // new tab; `data-act` is what keeps a plain click in this document, so the shop
      // stays instant. (A <button> could do neither: it has no address to copy, and all
      // 102 listings shared the homepage URL.)
      const href = productHref(p);
      return `
        <article class="product">
          <a class="product-image" href="${href}" aria-label="View ${p.name}" data-product-link data-act="openProduct" data-arg="${p.id}">
            <img src="${assetURL(p.img)}" alt="${p.name}" loading="lazy" decoding="async" width="400" height="400">
          </a>
          <div class="p-info">
            <div class="brand">${p.brand}</div>
            <a class="name" href="${href}" data-product-link data-act="openProduct" data-arg="${p.id}">${p.name}</a>
            ${colorRepeatsName(p) ? '' : `<div class="color">${p.color}</div>`}
            ${sizeText ? `<div class="sizes${sizeQuery ? ' sizes-match' : ''}">${sizeText}</div>` : ''}
            <div class="price-note">Price on request</div>
            <a class="quick" href="${href}" data-product-link data-act="openProduct" data-arg="${p.id}" data-stop="1">
              ${buttonText}
            </a>
          </div>
        </article>
      `;
    }

    /* == catalog-driven filter UI ==
       These lists used to be hardcoded in the markup, which let them drift out of
       sync with the catalog: four brand tiles matched no product at all, the
       condition filter offered a "Pre-owned" option nothing carried, and the size
       dropdown covered 8 of the 28 sizes actually in stock — leaving 33 of 72
       pairs unreachable through the filters. Deriving them from `products` means a filter can
       never again advertise a value the catalog doesn't have. */
    let CATALOG_BRANDS = [];
    let TILE_BRANDS = [];

    // Brands shown on the homepage grid, in display order. A brand with nothing
    // behind it yet renders as a dashed "Soon" tile and says so if you click
    // one, rather than dropping you on a confusing empty grid. As soon as a
    // product answers for the brand, the tile goes live on its own with no edit
    // here. Matching is case-insensitive, so "SUPREME" picks up products whose
    // brand string reads "Supreme" — and a tile also answers for collaborations
    // named for it, so "TRAVIS SCOTT" picks up the Travis Scott pairs filed
    // under Jordan and Nike instead of claiming no pairs are in stock yet.
    //
    // This one list is also what the shop's BRAND dropdown offers, so a brand taken
    // out of it leaves both the grid and that dropdown.
    const BRAND_TILES = ['Jordan', 'Nike', 'adidas', 'New Balance', 'TRAVIS SCOTT', 'SUPREME'];

    // A wordmark per brand, drawn rather than fetched. Nothing in this table is a logo
    // file and nothing is asked of a third party: a brand's lockup is mostly its
    // letterforms, so each name is *set* — in the two families the page already loads,
    // shaped by weight, width, slant, tracking and case — and the tile reads as the
    // brand without an image anybody has to have the right to use. The one place a mark
    // really is a shape (adidas's three bars, Supreme's box) the shape is drawn in CSS
    // in styles.css, next to the rest of the mark.
    //
    // `wm` is markup, so the only HTML in it is the <br> that stacks Travis Scott's two
    // words; a brand name is never interpolated into it. `mark` names the
    // .brand-tile[data-mark=…] rule that shapes it, and the casing here is the casing
    // the brand writes — the sheet only spells out what this table already decided, so
    // the DOM keeps "adidas" and "Supreme" as the brands write them.
    const BRAND_MARKS = {
      // Condensed caps that lean forward, set tight: the letterforms of the Jordan lockup.
      'jordan':       { wm: 'JORDAN',          mark: 'condensed' },
      // Four letters, set as large as the tile allows and leaning hard — the way the
      // wordmark is drawn on a box.
      'nike':         { wm: 'NIKE',            mark: 'oblique' },
      // Lowercase and upright, letterforms closed up, with the three bars beneath.
      'adidas':       { wm: 'adidas',          mark: 'bars' },
      // Lowercase and slanted, the way the tag reads.
      'new balance':  { wm: 'new balance',     mark: 'lower' },
      // Two words in wide-tracked caps, stacked — the lockup's whole character.
      'travis scott': { wm: 'TRAVIS<br>SCOTT', mark: 'wide' },
      // White, oblique, title case, on the red the box is printed in.
      'supreme':      { wm: 'Supreme',         mark: 'box' }
    };

    // Hat sizes are fractions ("7 1/4"), so turn them into decimals before comparing.
    function sizeNumber(m) {
      if (!m[1]) return 999;
      const frac = /^\s+(\d+)\/(\d+)/.exec(m[2] || '');
      return parseFloat(m[1]) + (frac ? frac[1] / frac[2] : 0);
    }

    const LETTER_SIZE_RANK = { XS: 0, S: 1, M: 2, L: 3, XL: 4, XXL: 5 };

    function compareSizes(a, b) {
      const ca = sizeCategory(a);
      const cb = sizeCategory(b);
      // Alphabetical would put "M" ahead of "S"; an Apparel group reads better in
      // dress order, and (theoretical) mixed comparisons keep apparel together.
      if (ca === 'Apparel' || cb === 'Apparel') {
        const rank = (v, c) => c === 'Apparel' && LETTER_SIZE_RANK[v.toUpperCase()] !== undefined ? LETTER_SIZE_RANK[v.toUpperCase()] : 99;
        const ra = rank(a, ca);
        const rb = rank(b, cb);
        return ra - rb || String(a).localeCompare(String(b));
      }
      const pa = /^(\d+(?:\.\d+)?)(.*)$/.exec(a) || [];
      const pb = /^(\d+(?:\.\d+)?)(.*)$/.exec(b) || [];
      const na = sizeNumber(pa);
      const nb = sizeNumber(pb);
      return na - nb || String(pa[2] || a).localeCompare(String(pb[2] || b));
    }

    function uniqSorted(list, cmp) {
      const out = [];
      list.forEach(v => { if (v && out.indexOf(v) === -1) out.push(v); });
      return out.sort(cmp || ((x, y) => x.localeCompare(y)));
    }

    // What a brand tile — and the brand dropdown — answers for: the brand
    // itself, plus collaborations named for it. The Travis Scott pairs are filed
    // under Jordan and Nike, so a brand-only match left the tile claiming "no
    // pairs in stock yet" for a brand the shop sells, and tapping it landed on
    // an empty grid. One rule serves the tile, the dropdown and the empty-state
    // guard, so the three can never disagree about whether a brand has stock.
    function matchesBrand(brand, product) {
      const b = String(brand || '').trim().toLowerCase();
      if (!b) return false;
      return String(product.brand || '').toLowerCase() === b ||
        String(product.name || '').toLowerCase().indexOf(b) >= 0;
    }

    function renderFilterUI() {
      const inStock = uniqSorted(products.map(p => (p.brand || '').trim()));
      CATALOG_BRANDS = inStock;
      const conditions = uniqSorted(products.map(p => (p.condition || '').trim()));

      // The tile grid is the shop's roadmap, not a mirror of current stock, so it
      // always shows every brand on the list above. Anything a product actually
      // carries gets appended, which means a new brand never silently goes missing.
      const tiles = BRAND_TILES.slice();
      // Case-insensitive on purpose: the roadmap list spells it "SUPREME" while the
      // catalog spells it "Supreme", so a case-sensitive check listed the brand twice.
      uniqSorted(inStock).forEach(b => { if (!tiles.some(t => t.toLowerCase() === b.toLowerCase())) tiles.push(b); });
      TILE_BRANDS = tiles;

      $('brandFilter').innerHTML = '<option value="">All Brands</option>' +
        tiles.map(b => `<option value="${b}">${b}</option>`).join('');

      // Group sizes by the run they belong to, so "2Y" is not offered as if it were
      // a men's size next to "US 10", a "S" isn't passed off as a men's shoe, and a
      // hat fraction like "7 1/4" gets a Headwear group of its own. The group is
      // taken from the listing that holds the size, not from the string alone: a
      // bare "7" is a men's shoe size in this catalog and also a real fitted-cap
      // size, so grouping the deduped strings filed the cap's 7 under Men as
      // "US 7". The same string can therefore appear under two groups at once.
      // The option value carries the run too ("Headwear|7"), so picking it
      // filters by run as well as size — a bare value could never say which 7
      // the shopper meant.
      const sizeGroups = { Men: [], Women: [], Youth: [], Apparel: [], Headwear: [] };
      products.forEach(p => (p.sizes || []).forEach(s => {
        const g = sizeCategory(s, p.sizeGroup);
        if (sizeGroups[g] && sizeGroups[g].indexOf(s) === -1) sizeGroups[g].push(s);
      }));
      const sizeGroupOrder = ['Men', 'Women', 'Youth', 'Apparel', 'Headwear'];
      sizeGroupOrder.forEach(g => sizeGroups[g].sort(compareSizes));
      $('sizeFilter').innerHTML = '<option value="">All Sizes</option>' +
        sizeGroupOrder.filter(g => sizeGroups[g].length).map(g =>
          '<optgroup label="' + g + '">' +
          sizeGroups[g].map(s => `<option value="${g}|${s}">${sizeDisplay(s, g)}</option>`).join('') +
          '</optgroup>').join('');

      // A dropdown whose only option is the filter's own default is noise, so the
      // CONDITION row hides itself until the catalog carries a second condition.
      const conditionSelect = $('conditionFilter');
      const conditionRow = conditionSelect.closest('.filter');
      if (conditions.length > 1) {
        conditionSelect.innerHTML = '<option value="">All Conditions</option>' +
          conditions.map(c => `<option value="${c}">${c === 'New' ? 'Brand New (Deadstock)' : c}</option>`).join('');
        if (conditionRow) conditionRow.style.display = '';
      } else {
        conditionSelect.innerHTML = '<option value="">All Conditions</option>';
        if (conditionRow) conditionRow.style.display = 'none';
      }

      // Tiles are <button>, so they take focus and activate on Enter/Space. The
      // .brand-tile:focus-visible rule further up was written for exactly this and
      // could never fire while these were <div onclick>…>.
      //
      // What a tile shows is a wordmark, not the catalog's brand string: data-mark names
      // the mark (BRAND_MARKS above), and the span carries the name as the brand writes
      // it. The text comes from the table rather than from the catalog string so
      // "adidas" keeps its lowercase and "Supreme" its capital, while the tile still
      // filters by the catalog's own spelling — TILE_BRANDS is what a click looks up.
      $('brandGrid').innerHTML =
        `<button type="button" class="brand-tile" data-mark="all" data-act="filterByBrand" data-arg="">` +
          `<span class="wm">All Brands</span></button>` +
        tiles.map((b, i) => {
          const has = products.some(p => matchesBrand(b, p));
          const m = brandMark(b);
          return `<button type="button" class="brand-tile${has ? '' : ' soon'}" data-mark="${m.mark}"` +
            `${m.len ? ` data-len="${m.len}"` : ''} data-act="filterByBrandAt" data-arg="${i}"` +
            `${has ? '' : ` aria-label="${esc(b)} — no pairs in stock yet"`}` +
            `><span class="wm">${m.wm}</span>${has ? '' : '<span class="tag">Soon</span>'}</button>`;
        }).join('');

      // Chips follow the stricter rule — only brands that can actually return a
      // result. A suggestion chip that finds nothing is the worst kind of dead end.
      $('searchChips').innerHTML = CATALOG_BRANDS.slice(0, 5).map((b, i) =>
        `<button type="button" data-act="setSearchBrand" data-arg="${i}">${b}</button>`).join('');
    }

    // Tiles and chips pass an index instead of a quoted brand string, so a brand
    // containing an apostrophe can't break out of the inline handler.
    function filterByBrandAt(i, el) { filterByBrand(TILE_BRANDS[i], el); }
    function setSearchBrand(i) { setSearch(CATALOG_BRANDS[i]); }

    // The mark for a brand: BRAND_MARKS if there is one, otherwise the plain title
    // treatment, stepped down as the name gets longer. A brand the catalog carries and
    // this table has never heard of is not a hole in the grid — it is set in the same
    // face as everything else and still names itself, which is what "The North Face"
    // needs at 150px.
    function brandMark(name) {
      const plain = String(name || '').trim();
      const known = BRAND_MARKS[plain.toLowerCase()];
      if (known) return known;
      return {
        wm: esc(plain),
        mark: 'plain',
        len: plain.length > 13 ? 'long' : (plain.length > 9 ? 'med' : 'short')
      };
    }

    // Scroll-reveal for product grids: a staggered IntersectionObserver on .product.
    // Products start hidden (opacity: 0, translateY: 20px) and reveal as they enter
    // the viewport, with a 50ms delay between each for a cascade effect.
    //
    // Two rules keep a grid from ever being drawn blank, both learned the hard way
    // when search results came back as empty space:
    //  · Every function that injects .product cards has to call this again. The
    //    observer only ever watches the nodes handed to it, and re-rendering a grid
    //    throws the old ones away — search results and the header modal's shortlist
    //    were never watched, so they stayed at opacity 0 and the panel looked empty
    //    even though the cards were in the DOM.
    //  · Anything already behind the reader is shown at once (revealPast): a card above
    //    the viewport never intersects, so waiting for the observer would hide it for
    //    good. That is also what covers a grid drawn while its view was still hidden —
    //    a card with no layout yet is left to the observer instead, so the cascade
    //    survives the menus being built off-screen.
    // The hidden state itself lives behind body.reveals-armed, which only this function
    // sets, so a browser without IntersectionObserver — or a future render path that
    // forgets to call this — shows the cards instead of swallowing them.
    let revealObserver = null;
    let sweepQueued = false;

    // Reads first, then writes: a scroll runs this on every tick and interleaving
    // getBoundingClientRect with classList would force a layout per card.
    function revealPast() {
      if (!document.body || !document.body.classList) return;
      if (!document.body.classList.contains('reveals-armed')) return;
      const behind = [];
      document.querySelectorAll('.product').forEach((el) => {
        if (el.classList.contains('reveal')) return;
        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (rect && rect.height > 0 && rect.bottom <= 0) behind.push(el);
      });
      behind.forEach((el) => el.classList.add('reveal'));
    }

    function queueRevealPast() {
      if (sweepQueued) return;
      sweepQueued = true;
      setTimeout(() => { sweepQueued = false; revealPast(); }, 0);
    }

    function observeProducts() {
      if (typeof IntersectionObserver !== 'function') return;   // no effect, but no blank grid either
      if (document.body && document.body.classList) document.body.classList.add('reveals-armed');

      if (!revealObserver) {
        revealObserver = new IntersectionObserver((entries) => {
          // Count the stagger over the cards landing on screen, never over the batch: a
          // batch also carries the cards a re-render just threw away and every card still
          // below the fold, and numbering those left a live card behind 85 dead ones — a
          // 4.3s wait, which is a blank grid to whoever tapped Random Shit. The cap then
          // stops a whole-grid first paint from stretching its last card's wait for good.
          let step = 0;
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const card = entry.target;
            revealObserver.unobserve(card);
            setTimeout(() => card.classList.add('reveal'), Math.min(step++, 6) * 50);
          });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        // One listener each for the two moments a card can slip behind the reader: the
        // shopper scrolling down past a grid, and a view change that leaves the page
        // somewhere below the top of the grid it just drew.
        if (window.addEventListener) {
          window.addEventListener('scroll', queueRevealPast, { passive: true });
          window.addEventListener('hashchange', queueRevealPast);
        }
      }

      // Behind-the-reader cards are shown first, so the loop below only hands over the ones
      // the observer can still report on.
      revealPast();
      document.querySelectorAll('.product').forEach((el) => {
        if (el.classList.contains('reveal')) return;   // already shown, don't queue it again
        revealObserver.observe(el);
      });
    }

    // Render Home Sections
    function renderHome() {
      $('trending').innerHTML = products.filter(p => p.brand.toLowerCase() === 'jordan').slice(0, 4).map(p => productCard(p)).join('');
      $('recent').innerHTML = products.slice(-4).map(p => productCard(p)).join('');
      $('clothing-accessories').innerHTML = products.filter(p => productCategory(p) === 'clothing').map(p => productCard(p)).join('');
      $('random-shit').innerHTML = products.filter(p => productCategory(p) === 'random').map(p => productCard(p)).join('');
      observeProducts();
    }

    // Handle Dual Search Inputs (Desktop & Mobile)
    function handleSearchSync(source) {
      if (source === 'desktop' && $('mobileSearch')) {
        $('mobileSearch').value = $('filterSearch').value;
      } else if (source === 'mobile' && $('filterSearch')) {
        $('filterSearch').value = $('mobileSearch').value;
      }
      renderShop();
    }

    // A bare number used to be treated as a keyword, so searching "11" matched any
    // product whose name happened to contain those digits — Air Jordan 11, a colourway
    // that mentions 11 — and people got back shoes that were never held in the size they
    // asked for. A number is now read as a size query and matched against the size list,
    // while anything non-numeric stays a keyword search.
    // Nothing in the catalog is larger than a US 14, so a bigger number is a model number
    // rather than a size: "700" has to keep finding Yeezy 700s instead of reporting that
    // no US 700 exists.
    const MAX_SIZE_QUERY = 16;
    const APPAREL_SIZES = ['s', 'm', 'l', 'xl', 'xs', 'xxl'];

    function parseSizeQuery(q) {
      const str = String(q || '').trim().toLowerCase();
      // A bare letter is an apparel run: "m" and "xl" should find sizes, not every
      // product whose name happens to contain the letter. Anything outside the
      // apparel vocabulary still falls through to keyword search.
      const letter = /^([a-z]+)$/.exec(str);
      if (letter && APPAREL_SIZES.indexOf(letter[1]) !== -1) {
        return { value: letter[1], suffix: '', letters: true, display: 'Size ' + letter[1].toUpperCase() };
      }
      const m = /^(?:size\s*)?(?:us\s*)?(\d+(?:\.\d+)?)([a-z]*)$/i.exec(str);
      if (!m) return null;
      const value = parseFloat(m[1]);
      if (!Number.isFinite(value) || value > MAX_SIZE_QUERY) return null;
      // A whole number covers its half size too ("11" reads as 11 / 11.5), so the
      // empty-state copy can say exactly what was searched.
      const suffix = m[2].toLowerCase();
      const half = suffix === '' && value % 1 === 0 ? ' / ' + (value + 0.5) : '';
      return { value, suffix, letters: false, display: 'US ' + value + half };
    }

    // A whole-number query ("11") shows that size and its half ("11.5") — shoe runs
    // come in half steps, and a shopper typing "11" wants both. A query that already
    // names the half ("11.5") or a specific run ("5.5w", "13k") matches only that
    // exact size, and letter queries ("m", "xl") match the exact apparel size.
    // A suffixed run never bleeds into a bare number: "11" stays clear of 11W/11K.
    function matchesSize(product, sizeQuery) {
      return (product.sizes || []).some(s => {
        const st = String(s).trim();
        if (sizeQuery.letters) return st.toLowerCase() === sizeQuery.value;
        const parsed = /^(\d+(?:\.\d+)?)(.*)$/.exec(st);
        if (!parsed) return false;
        const value = parseFloat(parsed[1]);
        if (!Number.isFinite(value)) return false;
        const suffix = parsed[2].toLowerCase();
        if (suffix !== sizeQuery.suffix) return false;
        if (value === sizeQuery.value) return true;
        return sizeQuery.suffix === '' && sizeQuery.value % 1 === 0 && value === sizeQuery.value + 0.5;
      });
    }

    // The sizes a card should show for the search it is answering: the whole run when
    // nothing was asked, only the sizes that matched when a size query is live.
    function matchingSizes(product, sizeQuery) {
      const all = (product && product.sizes) ? product.sizes.slice() : [];
      if (!sizeQuery) return all;
      return all.filter(s => matchesSize({ sizes: [s] }, sizeQuery));
    }

    // The size search the shop is running right now, read off the shop's own boxes. The
    // header modal has a box of its own and a query of its own, so it never lands here.
    function shopSizeQuery() {
      const raw = ($('filterSearch') && $('filterSearch').value) ||
        ($('mobileSearch') && $('mobileSearch').value) || '';
      const q = String(raw).trim().toLowerCase();
      return q ? parseSizeQuery(q) : null;
    }

    // The dropdown's value names the run as well as the size ("Headwear|7"): a
    // bare "7" is a men's shoe size and a fitted-cap size, so the value alone
    // cannot say which one the shopper picked. Split it back apart before
    // filtering. A value with no bar is a bare size, as before.
    function parseSizeFilter(value) {
      const raw = String(value || '');
      const bar = raw.indexOf('|');
      if (bar < 0) return { group: '', size: raw };
      return { group: raw.slice(0, bar), size: raw.slice(bar + 1) };
    }

    // Render Shop with Active Filters & Sorter
    function renderShop() {
      shopRendered = true;
      let list = [...products];
      const q = ($('filterSearch')?.value || $('mobileSearch')?.value || '').trim().toLowerCase();
      const brand = $('brandFilter')?.value;
      const size = $('sizeFilter')?.value;
      const condition = $('conditionFilter')?.value;
      const sizeQuery = q ? parseSizeQuery(q) : null;

      if (sizeQuery) {
        list = list.filter(p => matchesSize(p, sizeQuery));
      } else if (q) {
        list = list.filter(p => 
          (p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.sku).toLowerCase().includes(q)
        );
      }
      if (shopCategoryFilter) {
        list = list.filter(p => productCategory(p) === shopCategoryFilter);
      }
      if (brand) {
        list = list.filter(p => matchesBrand(brand, p));
      }
      if (size) {
        // The run gates the match: Headwear's 7 must not pull in the men's shoe
        // held in 7, and Men's 7 must not pull in the cap.
        const picked = parseSizeFilter(size);
        list = list.filter(p => (p.sizes || []).some(s =>
          s === picked.size && (!picked.group || sizeCategory(s, p.sizeGroup) === picked.group)));
      }
      if (condition) {
        list = list.filter(p => p.condition === condition);
      }

      const sort = $('sort')?.value || 'featured';
      if (sort === 'new') list.sort((a, b) => b.id - a.id);

      // A brand tile with nothing behind it yet gets its own message. "No sneakers
      // found matching those filters" reads like the shop is broken; "no Supreme
      // items in stock yet" reads like the shop is early. A size search that finds
      // nothing gets its own line too, otherwise people assume the size is wrong.
      //
      // That stock line is only allowed to run when the brand really is empty. It was
      // printed whenever a brand filter came back with nothing, which turned a filter
      // the shopper couldn't see (a leftover category, before filterByBrand cleared it)
      // into "No Supreme items in stock yet" over eight Supreme tees — a claim about the
      // catalog made by a filter. Everything below now answers for the filter it applied.
      const brandHasStock = brand
        ? products.some(p => matchesBrand(brand, p))
        : false;
      const emptyCopy = brand && !list.length
        ? (brandHasStock
          ? `Nothing in ${brand} matched those filters — clear one to see the rest.`
          : `No ${brand} items in stock yet — new stock goes up weekly.`)
        : (sizeQuery
          ? `Nothing in ${sizeQuery.display} right now — try another size.`
          : (shopCategoryFilter === 'clothing' ? 'No clothing found matching those filters.'
            : (shopCategoryFilter === 'random' ? 'Nothing in Random Shit matched those filters.'
              : 'No sneakers found matching those filters.')));

      // The size dropdown asks the same question as a typed size, so the cards answer
      // it the same way: the run it was set to is the run printed on them. The
      // value is split back into run and size first — parseSizeQuery only reads
      // the size — and a hat pick counts in hat language ("7", not "US 7 / 7.5").
      const pickedSize = size ? parseSizeFilter(size) : null;
      const filterSizeQuery = pickedSize ? parseSizeQuery(pickedSize.size.trim().toLowerCase()) : null;
      if (filterSizeQuery && pickedSize.group === 'Headwear') {
        filterSizeQuery.display = pickedSize.size;
      }
      const shownQuery = sizeQuery || filterSizeQuery;

      $('shopProducts').innerHTML = list.length
        ? list.map(p => productCard(p, shownQuery)).join('')
        : `<div class="empty-state"><p>${emptyCopy}</p><button class="btn light" data-act="clearFilters">Reset All Filters</button></div>`;

      // And the count says which sizes are on screen, so a shopper who typed 11 and sees
      // "US 11 · 11.5" on every card knows the grid answered them.
      $('productTotal').textContent = shownQuery
        ? list.length + ' ITEMS IN ' + shownQuery.display.toUpperCase()
        : list.length + ' ITEMS AVAILABLE';
      if ($('shopTitle')) $('shopTitle').textContent = CATEGORY_TITLES[shopCategoryFilter] || 'THE VAULT';
      updateFilterCount();
      observeProducts();
    }

    function toggleFilters(forceOpen) {
      const panel = $('filtersPanel');
      const btn = $('filterToggle');
      if (!panel || !btn) return;
      const open = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('open');
      panel.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }

    function updateFilterCount() {
      const btn = $('filterToggle');
      if (!btn) return;
      const n = ['brandFilter', 'conditionFilter'].filter(id => $(id) && $(id).value).length;
      btn.textContent = n ? 'More Filters (' + n + ')' : 'More Filters';
    }

    // Resetting the controls and redrawing the grid are two jobs. The category tiles below
    // want only the first: they set their own category and call renderShop() themselves, so
    // going through clearFilters() drew the whole 85-card vault into a shop view that was
    // still display:none, then threw those cards — and the image requests they start — away
    // a moment later for the four the shopper had actually asked for.
    function resetFilters() {
      ['filterSearch', 'mobileSearch', 'brandFilter', 'sizeFilter', 'conditionFilter'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      if ($('sort')) $('sort').value = 'featured';
      shopCategoryFilter = '';
      document.querySelectorAll('.brand-tile').forEach(t => t.classList.remove('selected'));
    }

    function clearFilters() {
      resetFilters();
      renderShop();
    }

    // Brand Tile Click Handler
    //
    // A tile asks one question — what does this brand have — so the filters the shop was
    // left holding have to go first, the category included. A tap used to keep whatever
    // category the last visit set: tap SHOP SNEAKERS in the hero (or Clothing, or Random
    // Shit), come home, tap Supreme, and the grid answered 0 with "No Supreme items in
    // stock yet" while eight Supreme tees sat in the catalog. Jordan, Nike, adidas and
    // New Balance only survived because they happen to be sneakers; Bearbrick, Huffy,
    // MadCan, New Era and The North Face all read as out of stock. The category has no
    // control in the filter bar, so nothing on screen named that filter and nothing but
    // the empty state's Reset button could clear it — after the shopper had already been
    // told the shop didn't carry the brand.
    function filterByBrand(brand, el) {
      // Ignore a brand that isn't on the tile list at all, rather than silently
      // filtering to nothing. A brand that's listed but not yet stocked is a
      // different case — that one keeps its filter and explains itself below.
      const known = TILE_BRANDS.some(b => b.toLowerCase() === String(brand || '').toLowerCase());
      // Same order shopNav() uses: clear what the shop was asking, then set the brand.
      resetFilters();
      // resetFilters() strips .selected from every tile, so the tap is marked after it.
      if (el) el.classList.add('selected');
      if ($('brandFilter')) $('brandFilter').value = known ? brand : '';
      go('shop');
      renderShop();
    }

    // Page View Controller with SPA History + Hash Routing
    // Canonical URLs: #home · #shop · #about · #product/<id>
    let activeSection = null;   // in-page anchor currently targeted on the home page
    let lastHash = '';          // last URL we applied; de-dupes popstate + hashchange

    function showPage(page, pid, restore) {
      document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
      // Containers are id="view-<name>" with a data-view key, NOT id="<name>".
      // An element whose id equals the hash is a fragment target, so the browser
      // scrolled <div id="shop"> to the top of the viewport on load — after the
      // load event, so nothing in this script could undo it in time — parking
      // every fresh #home/#shop/#about view just above the sticky nav with the
      // announcement bar scrolled out of sight. Prefixing the ids removes the
      // collision entirely, so the browser never scrolls on its own.
      const target = $('view-' + page) || $('view-home');
      target.classList.add('active');
      // The shop grid is the heaviest thing this script builds — 102 cards — and plenty of
      // visits never open it: the hero, one of the home rails, or a shared /product/ link
      // is the whole visit. So it is built the first time the view is actually shown
      // rather than at boot. Same cards in the same order, just not built for a page nobody
      // looked at. Every filter, size search and category tile already ends in renderShop()
      // itself, so this only ever covers the first arrival.
      if (target.dataset.view === 'shop' && !shopRendered) renderShop();
      if (target.dataset.view === 'product' && (restore || pid)) {
        renderProduct(pid || current.id);
      }
      syncStructuredData(target.dataset.view || page);
      closeAllDrawers();
      syncRouteUI();
    }

    // Build the canonical hash URL for a view
    function hashURL(page, pid, section) {
      if (page === 'product' && pid != null) return '#product/' + pid;
      if (page === 'home') return '#' + (section || 'home');
      return '#' + (page || 'home');
    }

    // Read a hash URL back into a route descriptor
    function parseHash(raw) {
      const h = String(raw || '').replace(/^#/, '');
      if (!h || h === 'home') return { page: 'home', pid: null, section: null };
      if (h === 'shop' || h === 'about') return { page: h, pid: null, section: null };
      if (h === 'product') return { page: 'product', pid: null, section: null };
      if (h.indexOf('product/') === 0) {
        const pid = Number(h.slice('product/'.length));
        return { page: 'product', pid: Number.isFinite(pid) ? pid : null, section: null };
      }
      return { page: 'home', pid: null, section: h };   // plain anchors
    }

    function hstate(y, section) {
      const active = document.querySelector('.page.active');
      const page = (active && active.dataset.view) || 'home';
      const sec = (section === undefined) ? activeSection : section;
      return {
        page: page,
        pid: (page === 'product' && current) ? current.id : null,
        section: (page === 'home' && sec) ? sec : null,
        y: Math.round(y || 0)
      };
    }

    // The URL an entry is written as. A listing is a path (/product/<slug>/) because it
    // is a page of its own; every other view is a hash on the root document. Coming from
    // a listing page the hash has to ride on "/" — pushState('#shop') would leave the
    // browser on /product/<slug>/#shop, where a reload would reopen the pair instead of
    // the view the shopper moved to.
    function urlFor(s) {
      if (s.page === 'product' && s.pid != null) {
        const p = products.find(x => x.id === s.pid);
        if (p && slugger) return productHref(p);
      }
      const hash = hashURL(s.page, s.pid, s.section);
      return onProductPath() ? '/' + hash : hash;
    }

    // Write history with a real URL. Opaque origins (file://) reject pushState
    // URLs, so fall back to assigning location.hash — the router already ran.
    function writeHistory(mode, s, url) {
      const target = url || urlFor(s);
      try {
        if (mode === 'push') history.pushState(s, '', target);
        else history.replaceState(s, '', target);
        lastHash = urlKey();
      } catch (e) {
        lastHash = target;
        if (location.hash !== target) location.hash = target;
      }
    }

    function hpush(s, url) { writeHistory('push', s, url); }
    function hreplace(s, url) { writeHistory('replace', s, url); }

    // Keep header links, the page title and assistive state in sync with the view
    function syncRouteUI() {
      const active = document.querySelector('.page.active');
      const page = (active && active.dataset.view) || 'home';
      document.querySelectorAll('.nav-links a').forEach(a => {
        const href = (a.getAttribute('href') || '').replace(/^#/, '');
        let on;
        if (page === 'home') on = activeSection ? href === activeSection : href === 'home';
        else if (page === 'product') on = href === 'shop';
        else on = href === page;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      if (page === 'product' && current) document.title = current.name + ' — Random Stock';
      else if (page === 'shop') document.title = 'Shop All Sneakers — Random Stock';
      else if (page === 'about') document.title = 'Our Story — Random Stock';
      else document.title = 'Random Stock — Hand-Checked Sneakers';
    }

    function go(page) {
      const activeEl = document.querySelector('.page.active');
      const from = (activeEl && activeEl.dataset.view) || 'home';
      const prev = hstate(window.scrollY);
      activeSection = null;                       // leaving home clears any section anchor
      hreplace(prev, urlFor(prev));               // remember where we came from
      showPage(page, null, false);
      if (!(from === page && window.scrollY < 2)) {
        hpush(hstate(0), urlFor(hstate(0)));      // new entry, new URL
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    function shopNav(brand) {
      resetFilters();
      if (brand && brand !== 'all') {
        $('brandFilter').value = brand;
      }
      go('shop');
      renderShop();
    }

    function shopCategory(category) {
      resetFilters();
      shopCategoryFilter = category;
      go('shop');
      renderShop();
    }

    // Product Detail Page Logic
    function openProduct(id) {
      closeAllDrawers();
      renderProduct(id);
      go('product');
    }

    function renderProduct(id) {
      current = products.find(p => p.id === id) || products[0];
      // A pair opened from a size search starts on the size that was searched: the order
      // sentence should name the 11 the shopper asked for, not the first size of the run.
      // Everywhere else it is the first size, exactly as it was.
      const sizeQuery = shopSizeQuery();
      const matchedSizes = matchingSizes(current, sizeQuery);
      selectedSize = matchedSizes[0] || current.sizes[0]; // initialize default selected size

      // Update breadcrumb
      if ($('breadcrumbProduct')) $('breadcrumbProduct').textContent = current.name;

      // Track recently viewed
      trackRecentlyViewed(current);

      // A listing with one photo shows one photo. This used to repeat current.img
      // four times to fill the 2x2 grid, so a single-angle item read as the same
      // shot pasted four times. .gallery-shot:only-child already spans a lone image
      // across the full width, and the "angle N" alt only means anything when there
      // really are several angles to page through.
      const galleryImages = current.gallery && current.gallery.length
        ? current.gallery
        : [current.img];
      const singlePhoto = galleryImages.length < 2;

      // The zoom viewer is handed this list rather than re-deriving it: the grid and the
      // full-viewport view are then incapable of disagreeing about which photo is which.
      galleryList = galleryImages.map((src, i) => ({
        src: assetURL(src),
        alt: singlePhoto ? current.name : current.name + ' angle ' + (i + 1)
      }));

      // Each shot is a button (see .gallery-shot): looking closer is the one thing a
      // buyer does here, and a bare <img> could only be clicked, never tabbed to or
      // opened from the keyboard.
      $('gallery').innerHTML = galleryList.map((shot, i) => `
        <button class="gallery-shot" type="button" data-act="zoomOpen" data-arg="${i}"
                aria-label="Zoom in on ${esc(shot.alt)}">
          <img src="${shot.src}" alt="${esc(shot.alt)}" ${i === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">
        </button>
      `).join('');

      const isSneaker = productCategory(current) === 'sneakers';
      const itemLabel = isSneaker ? 'pair' : 'item';
      const sizeLabel = 'Available sizes';
      const sizeAriaLabel = isSneaker ? 'Size US' : 'Size';
      const hasSizes = current.sizes.length > 0;

      // The pair is the <h1> of whatever document is showing it — including on the
      // homepage, where the hero line is also an <h1>. That is not two headings in one
      // outline: `.page { display: none }` means the hero's <h1> leaves the accessibility
      // tree the moment the product view becomes the active page, so whichever view is
      // visible supplies the document's single top-level heading. Demoting this to an <h2>
      // whenever the URL is "/" would instead leave the homepage's pair view with no <h1>
      // in the tree at all and an outline that starts at level 2. B14 pins the invariant.
      $('details').innerHTML = `
        <span class="eyebrow">${current.brand}</span>
        <h1>${current.name}</h1>
        ${colorRepeatsName(current) ? '' : `<p class="color" style="font-size:14px;color:var(--muted);margin:4px 0 16px">${current.color}</p>`}
        <div class="meta">
          SKU: ${current.sku}<br>
          CONDITION: ${current.condition}<br>
          PACKAGING: ${current.box || 'Original Box'}<br>
          PRICE: ON REQUEST — ASK US
        </div>
        ${current.details ? `<ul class="product-details">${current.details.map(d => `<li>${d}</li>`).join('')}</ul>` : ''}
        ${hasSizes ? `<div style="margin-top: 24px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
            <span class="eyebrow" style="color:var(--ink); font-weight:700">${sizeLabel}</span>
            <span class="eyebrow">${sizeCategoryLabel(current)}</span>
          </div>
          <div class="size-grid">
            ${current.sizes.map(s => `
              <button class="size-btn${s === selectedSize ? ' selected' : ''}${sizeQuery && matchedSizes.indexOf(s) >= 0 ? ' is-match' : ''}"
                      data-act="selectSize" data-arg="${s}"
                      aria-label="${sizeAriaLabel} ${s}">
                ${s}
              </button>
            `).join('')}
          </div>
          ${sizeQuery && matchedSizes.length ? `<p class="size-match-note">This ${itemLabel} is held in the sizes your search asked for: ${matchedSizes.map(s => sizeDisplay(s, current.sizeGroup)).join(' · ')}.</p>` : ''}
        </div>` : ''}
        <div class="order-cta">
          <a class="btn" id="orderCall" href="tel:${ORDER_PHONE}">Ask about this pair</a>
          <a class="btn light" id="orderText" href="sms:${ORDER_PHONE}">Text to ask about this ${itemLabel}</a>
        </div>
        <p class="order-note">${hasSizes ? `Sizes listed are what we hold right now. Call or text the ${itemLabel} and your size and we will confirm the price, availability, condition and shipping.` : `Call or text about this ${itemLabel} and we will confirm the price, availability, condition and shipping.`}</p>
        <div class="listing-qr" id="listingQr"></div>
        <div class="perks">
          <p>✓ <b>Authenticity promise:</b> Every pair is inspected in hand before listing.</p>
          <p>✓ <b>Insured Express Shipping:</b> Ships double-boxed with tracking in 1-2 business days.</p>
          <p>✓ <b>Buyer Protection:</b> Full refund if authenticity does not meet our standard.</p>
        </div>
      `;
      updateOrderLinks();
    }

    function selectSize(size, el) {
      selectedSize = size;
      document.querySelectorAll('.size-grid .size-btn').forEach(btn => btn.classList.remove('selected'));
      el.classList.add('selected');
      updateOrderLinks();
    }

    // Announcement bar. The bar in index.html hides itself by adding "hide" — but
    // that only lasts until the next load, which is why closing it felt pointless.
    // The choice is kept in localStorage, and index.html re-applies
    // "announce-dismissed" from the same key before the bar is parsed so a returning
    // shopper never sees it flash back. Keep the key in sync with that snippet.
    const ANNOUNCE_KEY = 'randomstock.announceDismissed';

    function announceDismiss() {
      if ($('announce')) $('announce').classList.add('hide');
      document.documentElement.classList.add('announce-dismissed');
      try {
        localStorage.setItem(ANNOUNCE_KEY, '1');
      } catch (err) {
        /* Storage blocked: the bar still closes for this visit, just not the next. */
      }
    }

    // Mobile Menu Drawer Handlers
    function menuOpen() {
      closeAllDrawers();
      $('mobileDrawer').classList.add('open');
      $('shade').classList.add('open');
      $('hambBtn').setAttribute('aria-expanded', 'true');
      trapFocus($('mobileDrawer'));
      const drawerClose = $('mobileDrawer').querySelector('.drawer-close');
      if (drawerClose) drawerClose.focus();
    }

    function menuClose() {
      $('mobileDrawer').classList.remove('open');
      $('shade').classList.remove('open');
      $('hambBtn').setAttribute('aria-expanded', 'false');
      releaseFocus();
    }

    function closeAllDrawers() {
      releaseFocus();
      if ($('searchBtn')) $('searchBtn').setAttribute('aria-expanded', 'false');
      $('mobileDrawer').classList.remove('open');
      // The search overlay must never outlive the view it opened from —
      // otherwise a result click navigates underneath it and the page looks frozen.
      $('searchModal').classList.remove('open');
      // Same rule for the order dialog, which also opens over a product view.
      if ($('orderModal')) $('orderModal').classList.remove('open');
      // And again for the photo viewer, which covers the whole screen: a route change
      // has to take it down with it, or the page navigates out of sight behind it.
      zoomClose();
      $('shade').classList.remove('open');
    }

    // Global Search Modal Handlers
    function searchOpen() {
      closeAllDrawers();
      $('searchModal').classList.add('open');
      if ($('searchBtn')) $('searchBtn').setAttribute('aria-expanded', 'true');
      trapFocus($('searchModal'));
      setTimeout(() => $('globalSearch').focus(), 150);
      globalSearch();
    }

    function searchClose() {
      $('searchModal').classList.remove('open');
      if ($('searchBtn')) $('searchBtn').setAttribute('aria-expanded', 'false');
      releaseFocus();
    }

    // Same rule as the shop filter search: a bare number is a size, not a keyword.
    // Typing "11" here has to surface the pairs actually held in 11 / 11.5 — not
    // every model whose name happens to contain the digits.
    function globalSearch() {
      const q = ($('globalSearch').value || '').trim().toLowerCase();
      if (!q) {
        $('searchResults').innerHTML = '';
        return;
      }
      const sizeQuery = parseSizeQuery(q);
      const matches = (sizeQuery
        ? products.filter(p => matchesSize(p, sizeQuery))
        : products.filter(p =>
            (p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.sku).toLowerCase().includes(q)
          )
      ).slice(0, 4);

      if (!matches.length) {
        $('searchResults').innerHTML = sizeQuery
          ? '<p style="grid-column: 1/-1; color: var(--muted); padding: 20px 0;">Nothing in ' + sizeQuery.display + ' right now — try another size.</p>'
          : '<p style="grid-column: 1/-1; color: var(--muted); padding: 20px 0;">No matching sneakers found.</p>';
      } else {
        $('searchResults').innerHTML = matches.map(p => productCard(p, sizeQuery)).join('');
        observeProducts();   // fresh nodes: the reveal observer has never seen them
      }
    }

    function setSearch(term) {
      $('globalSearch').value = term;
      globalSearch();
    }

    // ---- Order dialog: what a click on a tel:/sms: link opens on a desktop ------
    //
    // A phone hands tel: and sms: to the dialer and to Messages, so there the links
    // are left exactly as they were — tap and it opens. A desktop browser has
    // nowhere to put them: the click lands on nothing and the shopper is invited to
    // call a number they cannot call from a laptop. The dialog gives them the two
    // things that do work from a desk: a code their phone can scan, with whatever
    // they typed riding inside it, and actions that need no phone at all.
    //
    // The media feature, not a user-agent sniff, decides which case this is: it asks
    // the only question that matters — is there a pointer here that is not a finger.
    const fineMouseQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    let orderModeState = 'text';

    function phoneHandlesLinks() {
      return !(fineMouseQuery && fineMouseQuery.matches);
    }

    function orderModalOpen(href) {
      const link = String(href || '');
      orderModeState = link.indexOf('tel:') === 0 ? 'call' : 'text';

      // The page already knows what the shopper is looking at — the sms: link it
      // builds carries the pair and the chosen size — so the dialog starts from that
      // same sentence rather than an empty box.
      let message = '';
      const body = link.match(/[?&]body=([^&]*)/);
      if (body) {
        try { message = decodeURIComponent(body[1]); } catch (err) { message = ''; }
      }
      if (!message && orderModeState === 'text' && document.querySelector('#view-product.active')) {
        message = defaultOrderMessage();
      }
      if ($('orderMessage')) $('orderMessage').value = message;

      // closeAllDrawers() first: it is what puts the shade up for one dialog at a
      // time, and every one of them shares it.
      closeAllDrawers();
      $('orderModal').classList.add('open');
      $('shade').classList.add('open');
      trapFocus($('orderModal'));
      orderModalSync();
      setTimeout(() => { if ($('orderMessage')) $('orderMessage').focus(); }, 150);
    }

    function orderModalClose() {
      const modal = $('orderModal');
      if (!modal || !modal.classList.contains('open')) return;
      modal.classList.remove('open');
      $('shade').classList.remove('open');
      releaseFocus();
    }

    function orderModalMode(mode) {
      orderModeState = mode === 'call' ? 'call' : 'text';
      orderModalSync();
    }

    // What the code and the buttons point at right now: the typed message in text
    // mode, so a shopper's sentence arrives on the phone with the text.
    function orderTargetHref() {
      if (orderModeState === 'call') return 'tel:' + ORDER_PHONE;
      const field = $('orderMessage');
      return smsHref(field ? field.value.trim() : '');
    }

    function orderModalSync() {
      const isCall = orderModeState === 'call';
      const target = orderTargetHref();
      const message = ($('orderMessage') && $('orderMessage').value.trim()) || '';

      $('orderModalTitle').textContent = isCall ? 'Call us from your phone' : 'Text us from your phone';
      $('orderTabText').setAttribute('aria-pressed', isCall ? 'false' : 'true');
      $('orderTabCall').setAttribute('aria-pressed', isCall ? 'true' : 'false');
      $('orderQrNote').textContent = isCall
        ? 'Point your camera at the code to dial ' + ORDER_PHONE_DISPLAY
        : (message ? 'Point your camera at the code — your message goes with it'
                   : 'Point your camera at the code to open a text to ' + ORDER_PHONE_DISPLAY);
      $('orderQr').innerHTML = qrSvg(target, isCall
        ? 'QR code that dials ' + ORDER_PHONE_DISPLAY
        : 'QR code that opens a text message to Random Stock');
    }

    // Drawn as one SVG path. A <rect> per dark module would be several hundred nodes
    // for a code a scanner reads at a glance; runs of touching dark modules in a row
    // collapse into single rectangles instead, which is the same picture with a
    // fraction of the markup.
    function qrFallbackNote(reason) {
      return '<p class="order-qr-note">' + reason + '</p>';
    }

    // modulePx, when given, draws each module that many CSS pixels across and puts the
    // size on the tag. A code whose box is a whole multiple of its module count gives
    // every module the same width on screen, which is what a scanner's grid sampling
    // needs: measured against two independent decoders, a 57-module code still reads
    // from a straight screenshot at 2-3 px per module, but only at 4 does it also
    // survive being captured smaller than it is drawn. Left out, the tag carries no
    // size and the CSS decides — which is what the order dialog wants.
    function qrSvg(text, label, mayRetry, modulePx) {
      if (typeof qrcode !== 'function') {
        return qrFallbackNote('Text or call ' + ORDER_PHONE_DISPLAY + ' — the code needs qrcode.js.');
      }
      try {
        // UTF-8: a message with an emoji or an accent is common and the library's
        // default converter is one byte per character, which would put mojibake in
        // the text the phone receives. Set once, on the first code drawn.
        if (!qrSvg.utf8 && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
          qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
          qrSvg.utf8 = true;
        }

        const qr = qrcode(0, 'M');   // 0 = smallest version that fits; M ≈ 15% recovery
        qr.addData(text);
        qr.make();

        const count = qr.getModuleCount();
        const quiet = 4;             // the margin every scanner is told to expect
        const runs = [];
        for (let row = 0; row < count; row += 1) {
          let col = 0;
          while (col < count) {
            if (!qr.isDark(row, col)) { col += 1; continue; }
            let run = 1;
            while (col + run < count && qr.isDark(row, col + run)) run += 1;
            runs.push('M' + (col + quiet) + ' ' + (row + quiet) + 'h' + run + 'v1h-' + run + 'z');
            col += run;
          }
        }

        const size = count + quiet * 2;
        const box = modulePx ? ' width="' + size * modulePx + '" height="' + size * modulePx + '"' : '';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '"' + box +
          ' role="img" aria-label="' + label + '" shape-rendering="crispEdges">' +
          '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/>' +
          '<path d="' + runs.join('') + '" fill="#151515"/></svg>';
      } catch (err) {
        // Past the capacity of a version-40 code. The message is dropped rather than
        // the code: a shopper still scans it, and the Copy button still holds their text.
        const cut = text.indexOf('?');
        if (mayRetry !== false && cut > 0) return qrSvg(text.slice(0, cut), label, false, modulePx);
        return qrFallbackNote('Text or call ' + ORDER_PHONE_DISPLAY + ' — the code could not be drawn here.');
      }
    }

    // navigator.clipboard needs a secure context and a live user gesture; the
    // select-and-execCommand path is what keeps the button honest on http:// or in a
    // browser that withholds the modern API.
    function legacyCopy(text) {
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.setAttribute('readonly', 'readonly');
      scratch.style.position = 'fixed';
      scratch.style.top = '-1000px';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(scratch);
      return ok;
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
      }
      return Promise.resolve(legacyCopy(text));
    }

    function orderCopy() {
      const field = $('orderMessage');
      const message = field ? field.value.trim() : '';
      if (!message) {
        toast('Write your message first, then copy it.');
        if (field) field.focus();
        return;
      }
      copyText(message).then((ok) => {
        toast(ok
          ? 'Message copied — text it to ' + ORDER_PHONE_DISPLAY
          : 'Copy blocked by the browser — select the text and copy it by hand');
      });
    }

    // Photo Zoom
    //
    // The gallery draws every pair whole (object-fit: contain) so browsing never crops a
    // shoe — which is exactly why a shopper cannot check the thing this shop sells on:
    // the stitch line, the box label, the production stamp. Pressing a photo shows that
    // same file at the largest size the viewport allows. Nothing is fetched a second
    // time, because it is the URL the gallery already loaded, and we never scale the
    // image up ourselves, so the phone's own pinch still works on top of it.
    //
    // Listings here show one photo each today, so the arrows and the counter stay off
    // until a gallery really holds several angles — `gallery` in products.js and the
    // images jsonld.js advertises already allow them — rather than announcing "1 / 1".
    //
    // It is the gallery's own file, never a re-encoded or "bigger" version of it. The
    // squares in sneaker_images/square/ are 600px and are the whole of the detail this
    // shop holds for a pair, so scaling one up would only inflate a blur: on a phone the
    // pinch below reaches the file's own pixels, which is the most there is to see, and
    // the way to show a shopper more stitching than this is a larger source photo, not a
    // larger box to put it in.
    let zoomSwipeBound = false;

    function zoomChrome() {
      const many = galleryList.length > 1;
      if ($('zoomPrev')) $('zoomPrev').hidden = !many;
      if ($('zoomNext')) $('zoomNext').hidden = !many;
      if ($('zoomCount')) $('zoomCount').textContent = many ? (zoomIndex + 1) + ' / ' + galleryList.length : '';
    }

    function zoomShow(index) {
      const shot = galleryList[index];
      if (!shot) return;
      zoomIndex = index;
      $('zoomImg').src = shot.src;
      $('zoomImg').alt = shot.alt;
      zoomChrome();
    }

    function zoomOpen(index) {
      if (!galleryList.length) return;
      closeAllDrawers();
      zoomShow(index);
      $('zoom').classList.add('open');
      bindZoomSwipe();
      trapFocus($('zoom'));
      const close = $('zoom').querySelector('.zoom-close');
      // Deferred for the same reason searchOpen() defers its focus: the viewer fades in
      // from visibility: hidden, and a hidden element cannot take focus — until the
      // browser has recomputed the style, this call lands nowhere and a keyboard user is
      // left standing on the photo with no way forward. The guard keeps a shopper who
      // closes it inside the 150ms from having focus pulled off whatever they moved on to.
      if (close) setTimeout(() => { if ($('zoom').classList.contains('open')) close.focus(); }, 150);
    }

    // A no-op on a one-photo listing, so the ordinary case cannot be stepped off into a
    // blank frame.
    function zoomStep(delta) {
      if (galleryList.length < 2) return;
      zoomShow((zoomIndex + delta + galleryList.length) % galleryList.length);
    }

    function zoomClose() {
      const el = $('zoom');
      if (!el || !el.classList.contains('open')) return;
      el.classList.remove('open');
      releaseFocus();   // hands focus back to the photo it was opened from
    }

    // A sideways drag is the gesture a thumb makes on a full-screen photo, so it pages
    // through the angles. It is bound on the first open rather than at load — there is
    // no reason to hold a listener on a viewer nobody has asked for yet — and a mostly
    // vertical drag is left alone so the page can still be scrolled behind it.
    function bindZoomSwipe() {
      const el = $('zoom');
      if (zoomSwipeBound || !el) return;
      zoomSwipeBound = true;
      let startX = 0;
      let startY = 0;
      let tracking = false;
      el.addEventListener('touchstart', e => {
        tracking = e.touches.length === 1 && galleryList.length > 1;
        if (!tracking) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }, { passive: true });
      el.addEventListener('touchend', e => {
        if (!tracking || !e.changedTouches.length) return;
        tracking = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
        zoomStep(dx < 0 ? 1 : -1);
      }, { passive: true });
      // Tapping the backdrop dismisses; tapping the photo itself must not, or a shopper
      // leaning in to read a label closes the thing they opened.
      el.addEventListener('click', e => { if (e.target === el) zoomClose(); });
    }

    // Toast Utility
    let toastTimer;
    function toast(msg) {
      const el = $('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    // Keyboard & Accessibility Handler (Escape closes active modals)
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        menuClose();
        searchClose();
        orderModalClose();
        zoomClose();
        return;
      }
      // Arrow keys page through a listing's angles while the viewer is up. Nothing else
      // on this page answers to the arrows, and there is only ever something to step to
      // when a gallery holds more than one photo (see zoomStep).
      if ($('zoom') && $('zoom').classList.contains('open')) {
        if (e.key === 'ArrowRight') zoomStep(1);
        else if (e.key === 'ArrowLeft') zoomStep(-1);
      }
    });

    // History, Routing & Scroll Management Initialization
    let isRestoring = false;
    let scrollTimeout;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    // Apply a route that came from the URL (refresh, deep link, back/forward, manual edit)
    function applyRoute(route, force) {
      const key = urlKey();
      if (!force && key === lastHash) return;     // already applied (popstate + hashchange)
      lastHash = key;
      isRestoring = true;
      activeSection = route.section || null;
      showPage(route.page, route.pid, true);

      // Always (re)write the entry: canonicalises the URL (unknown product id,
      // bare '#product', empty hash…) and keeps the scroll offset in the state.
      const resolved = hstate(typeof route.y === 'number' ? route.y : 0, route.section || null);
      hreplace(resolved, urlFor(resolved));

      if (route.section) {
        setTimeout(() => {
          const el = $(route.section);
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        }, 70);
      } else {
        const y = typeof route.y === 'number' ? route.y : 0;
        try { window.scrollTo({ top: y, behavior: 'instant' }); }
        catch (_) { window.scrollTo(0, y); }
      }
      setTimeout(() => { isRestoring = false; }, 220);
    }

    // Restore the view described by the current URL on first paint
    function hydrateFromURL() {
      // A listing page was served for one pair and names it in the path, so that is the
      // route it restores. Its hash is empty, which parseHash would read as "#home" —
      // the reason this check comes first, and the reason a shared /product/<slug>/ link
      // no longer lands on the hero.
      const listed = pathProduct();
      const route = listed
        ? { page: 'product', pid: listed.id, section: null }
        : parseHash(location.hash);
      if (route.page === 'home' && !route.section) {
        // Plain home view: refresh the nav/title and normalise the URL
        hreplace(hstate(window.scrollY, null), '#home');
        syncRouteUI();
        return;
      }
      isRestoring = true;
      activeSection = route.section;
      showPage(route.page, route.pid, true);
      // Rewrite the entry with the resolved route (canonicalises bad product ids)
      const resolved = hstate(0, route.section || null);
      hreplace(resolved, urlFor(resolved));
      if (route.section) {
        setTimeout(() => {
          const el = $(route.section);
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        }, 80);
      }
      setTimeout(() => { isRestoring = false; }, 250);
    }

    window.addEventListener('scroll', () => {
      if (isRestoring) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (history.state && history.state.page) {
          hreplace(Object.assign({}, history.state, { y: Math.round(window.scrollY) }));
        }
      }, 120);
    });

    window.addEventListener('popstate', e => {
      if (e.state && e.state.page) applyRoute(e.state, true);
      else applyRoute(parseHash(location.hash), false);
    });

    // Fires when the hash is edited directly or a plain anchor is followed
    window.addEventListener('hashchange', () => {
      applyRoute(parseHash(location.hash), false);
    });

    // Every in-page anchor is wired to a JS handler, so stop the browser's own hash
    // jump (it would double up with pushState). Anchors without a handler still fall
    // through to the hashchange listener above.
    document.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || !a.hasAttribute('data-act')) return;
      e.preventDefault();
    });

    // A product card is a real link to the pair's own page, and a plain click is taken
    // over here so the shop stays instant: the data-act on the same anchor renders the
    // pair without a reload. A modified click is deliberately left alone — ctrl/cmd-click,
    // shift-click and a middle click keep the browser's own behaviour, so "open in new
    // tab", "open in new window" and "copy link address" all reach the prerendered page
    // with its own title, photo and structured data.
    document.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[data-product-link]') : null;
      if (!a) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
    });

    // tel: and sms: are only useful where something can answer them. On a fine
    // pointer — no phone behind it — the click becomes the order dialog instead.
    // Everywhere else the link is left alone, so a tap on a phone still opens the
    // dialer or Messages the way it always did.
    document.addEventListener('click', e => {
      if (phoneHandlesLinks()) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"], a[href^="sms:"]') : null;
      if (!a) return;
      // A tel:/sms: link inside the dialog itself is meant to act on its own.
      if (a.closest && a.closest('#orderModal')) return;
      e.preventDefault();
      orderModalOpen(a.getAttribute('href'));
    });

    // ---- Structured data for the view on screen -------------------------------
    //
    // index.html already carries the whole catalog as JSON-LD (written by
    // build-jsonld.js), which is what a crawler that never runs this script reads.
    // What only a live page can do is describe the product being looked at, with
    // every gallery shot, the packaging and one offering per size. It is removed as
    // soon as the view is not a product, so the page never advertises something it
    // is not showing.
    function syncStructuredData(page) {
      const existing = $('productJsonLd');
      // jsonld.js ships with the page; the Node test harnesses load app.js alone.
      const canWrite = typeof structuredData !== 'undefined' && page === 'product' && current;
      if (!canWrite) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        return;
      }
      const node = structuredData.product(current, { variants: true });
      const script = existing || document.createElement('script');
      script.type = 'application/ld+json';
      script.id = 'productJsonLd';
      script.textContent = structuredData.stringify(node);
      if (!existing) document.head.appendChild(script);
    }

    // Recently Viewed - localStorage-based visual return hook
    const RECENTLY_VIEWED_KEY = 'randomstock.recentlyViewed';
    const MAX_RECENT = 4;

    function trackRecentlyViewed(product) {
      try {
        let viewed = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
        viewed = viewed.filter(id => id !== product.id); // remove if already exists
        viewed.unshift(product.id); // add to front
        viewed = viewed.slice(0, MAX_RECENT); // keep only last 4
        localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(viewed));
        renderRecentlyViewed();
      } catch (err) {
        // localStorage blocked or full
      }
    }

    function renderRecentlyViewed() {
      try {
        const viewed = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
        if (!viewed.length) return;

        const recentProducts = viewed.map(id => products.find(p => p.id === id)).filter(Boolean);
        if (!recentProducts.length) return;

        // Check if section already exists
        let section = document.getElementById('recentlyViewedSection');
        if (!section) {
          section = document.createElement('section');
          section.id = 'recentlyViewedSection';
          section.className = 'section';
          section.innerHTML = `
            <div class="section-head" data-index="07">
              <div>
                <span class="eyebrow">Your History</span>
                <h2>RECENTLY VIEWED</h2>
              </div>
            </div>
            <div class="products" id="recentlyViewed"></div>
          `;
          // Insert before Random Shit section
          const randomSection = document.getElementById('random-section');
          if (randomSection && randomSection.parentNode) {
            randomSection.parentNode.insertBefore(section, randomSection);
          }
        }

        $('recentlyViewed').innerHTML = recentProducts.map(p => productCard(p)).join('');
        observeProducts();
      } catch (err) {
        // localStorage blocked
      }
    }

    // Initial Render — filters first: renderShop() reads their values to label the count
    // Hero video: the still image is the hero until the clip actually decodes, so a
    // missing video/reel.mp4 is invisible rather than a broken player.
    (function initHeroVideo() {
      const video = $('heroVideo');
      if (!video) return;
      const show = () => video.classList.add('is-ready');
      const hide = () => video.classList.remove('is-ready');
      video.addEventListener('loadeddata', show);
      video.addEventListener('canplay', show);
      video.addEventListener('error', hide);
      if (video.readyState >= 2) show();
    })();

    // The order dialog's lede sentence names the number, so it is written here from
    // the constant instead of typed into index.html: the markup is the one file a
    // scraper can fetch without running anything. A browser that never runs this
    // script cannot open the dialog anyway — app.js is what opens it — so nothing
    // is lost by the number arriving with the script.
    (function initOrderLede() {
      const slot = $('orderPhone');
      if (slot) slot.textContent = ORDER_PHONE_DISPLAY;
      // The announcement bar is the first thing on the page that says how to claim a
      // pair, so it names the number too — filled here rather than written into
      // index.html for the same reason as the lede above: the markup is the one file
      // anything can fetch without running this script.
      const bar = $('announcePhone');
      if (bar) {
        bar.textContent = ORDER_PHONE_DISPLAY;
        if (String(bar.tagName || '').toUpperCase() === 'A') bar.href = 'tel:' + ORDER_PHONE;
      }
    })();
    renderFilterUI();
    renderHome();
    renderRecentlyViewed();
    // renderShop() is deliberately not called here. The grid mounts when the shop view is
    // first shown (showPage), so boot builds the hero rails and nothing else; a visitor who
    // never opens the shop never pays for 102 cards.

    // Then restore whatever the URL asked for (refresh, shared link, bookmark)
    hydrateFromURL();

    // ---- Delegated UI actions -------------------------------------------------
    //
    // Markup names what a control does — data-act for clicks, data-input for
    // typing, data-change for selects — instead of inline on* attributes, so
    // no inline handlers remain and a Content-Security-Policy without
    // 'unsafe-inline' can govern scripts. One listener per event type walks
    // up from the event target to the named control and calls the same
    // function the inline attribute used to call:
    //   data-arg   the argument the inline call passed (parsed back to a
    //              number for product ids, gallery/brand indexes, zoom steps)
    //   data-pd    the inline call began with event.preventDefault()
    //   data-stop  the inline call began with event.stopPropagation()
    //   data-then  a second action to run right after the first (the old
    //              "menuClose(); shopCategory(...)" pairs in the drawer)
    // Actions that spent their life as `this` handlers (brand tiles, size
    // buttons) receive the control itself as the extra argument.
    const CLICK_ACTIONS = {
      announceDismiss: () => announceDismiss(),
      clearFilters: () => clearFilters(),
      closeAllDrawers: () => closeAllDrawers(),
      go: (el, arg) => go(arg),
      menuClose: () => menuClose(),
      menuOpen: () => menuOpen(),
      orderCopy: () => orderCopy(),
      orderModalClose: () => orderModalClose(),
      orderModalMode: (el, arg) => orderModalMode(arg),
      searchClose: () => searchClose(),
      searchOpen: () => searchOpen(),
      shopCategory: (el, arg) => shopCategory(arg),
      shopNav: (el, arg) => shopNav(arg),
      toggleFilters: () => toggleFilters(),
      zoomClose: () => zoomClose(),
      zoomStep: (el, arg) => zoomStep(parseInt(arg, 10)),
      openProduct: (el, arg) => openProduct(parseInt(arg, 10)),
      zoomOpen: (el, arg) => zoomOpen(parseInt(arg, 10)),
      setSearchBrand: (el, arg) => setSearchBrand(parseInt(arg, 10)),
      filterByBrand: (el, arg) => filterByBrand(arg, el),
      filterByBrandAt: (el, arg) => filterByBrandAt(parseInt(arg, 10), el),
      selectSize: (el, arg) => selectSize(arg, el)
    };
    function runAction(name, el) {
      const fn = CLICK_ACTIONS[name];
      if (fn) fn(el, el.getAttribute('data-arg'));
    }
    document.addEventListener('click', e => {
      const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) return;
      if (el.hasAttribute('data-pd')) e.preventDefault();
      if (el.hasAttribute('data-stop')) e.stopPropagation();
      runAction(el.getAttribute('data-act'), el);
      const then = el.getAttribute('data-then');
      if (then) runAction(then, el);
    });
    const INPUT_ACTIONS = {
      globalSearch: () => globalSearch(),
      handleSearchSync: (el, arg) => handleSearchSync(arg),
      orderModalSync: () => orderModalSync()
    };
    document.addEventListener('input', e => {
      const el = e.target && e.target.closest ? e.target.closest('[data-input]') : null;
      if (!el) return;
      const fn = INPUT_ACTIONS[el.getAttribute('data-input')];
      if (fn) fn(el, el.getAttribute('data-arg'));
    });
    const CHANGE_ACTIONS = {
      renderShop: () => renderShop()
    };
    document.addEventListener('change', e => {
      const el = e.target && e.target.closest ? e.target.closest('[data-change]') : null;
      if (!el) return;
      const fn = CHANGE_ACTIONS[el.getAttribute('data-change')];
      if (fn) fn(el, el.getAttribute('data-arg'));
    });
