// Random Stock store logic (rendering, router, search, filters, dialogs).
// Loaded AFTER products.js — the catalog array arrives via window.localProducts.
// No markup lives here; index.html holds the page structure only.

const products = [];
const moreProducts = [];
products.push(...moreProducts);
products.push(...(window.localProducts || []));

// State Management
    let current = products[0];
    let selectedSize = null;
    let galleryList = [];   // photos of `current`, in the order the gallery draws them
    let zoomIndex = 0;      // which of them the zoom viewer is showing

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
      if (/[YK]$/.test(s)) return 'Youth';
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

    // The shop answers orders by phone or text; this is the number, written once.
    const ORDER_PHONE = '+19144821144';
    const ORDER_PHONE_DISPLAY = '(914) 482-1144';

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
      updateOrderBar();
    }

    // The bar at the foot of a phone screen carries the same two actions and the same
    // sentence as the listing's own buttons: while a listing is on screen it names the
    // pair and the chosen size, so a tap on Text opens Messages with the order already
    // written; on any other view it is the number on its own, because a bare number is
    // the whole of what a call or a text from the home page can say. WhatsApp takes the
    // same ?text=, and — unlike tel: and sms: — has somewhere to land from a desk, so
    // it has no part in the phoneHandlesLinks() split.
    //
    // The call link is rewritten from ORDER_PHONE rather than trusted from the markup,
    // which is the same rule the listing's own Call button follows: the number is
    // written once in this file.
    function updateOrderBar() {
      const call = $('barCall');
      const text = $('barText');
      if (!call || !text) return;   // a page that ships without the bar
      call.href = 'tel:' + ORDER_PHONE;
      const message = document.querySelector('#view-product.active') ? defaultOrderMessage() : '';
      text.href = smsHref(message);
      const wa = $('barWa');
      if (wa) wa.href = 'https://wa.me/' + ORDER_PHONE.replace('+', '') + (message ? '?text=' + encodeURIComponent(message) : '');
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
    const CATEGORY_TITLES = { clothing: 'CLOTHING & ACCESSORIES', random: 'RANDOM SHIT' };
    let shopCategoryFilter = '';

    // Product Card Template
    function productCard(p) {
      const isSneaker = productCategory(p) === 'sneakers';
      const buttonText = isSneaker ? 'VIEW PAIR' : 'VIEW ITEM';
      const sizeText = isSneaker && p.sizes.length ? `US ${p.sizes.slice(0, 4).join(' · ')}${p.sizes.length > 4 ? ' · +' : ''}` : '';
      return `
        <article class="product">
          <button class="product-image" type="button" aria-label="View ${p.name}" onclick="openProduct(${p.id})">
            <img src="${p.img}" alt="${p.name}" loading="lazy">
          </button>
          <div class="p-info">
            <div class="brand">${p.brand}</div>
            <button class="name" type="button" onclick="openProduct(${p.id})">${p.name}</button>
            <div class="color">${p.color}</div>
            ${sizeText ? `<div class="sizes">${sizeText}</div>` : ''}
            <button class="quick" onclick="event.stopPropagation(); openProduct(${p.id})">
              ${buttonText}
            </button>
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

    // Brands shown on the homepage grid, in display order. Several of these are
    // placeholders for stock that hasn't been added yet — they render as dashed
    // "Soon" tiles and say so if you click one, rather than dropping you on a
    // confusing empty grid. As soon as a product carries the brand, the tile goes
    // live on its own with no edit here. Matching is case-insensitive, so
    // "SUPREME" picks up products whose brand string reads "Supreme".
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

    function renderFilterUI() {
      const inStock = uniqSorted(products.map(p => (p.brand || '').trim()));
      CATALOG_BRANDS = inStock;
      const sizes = uniqSorted(products.reduce((acc, p) => acc.concat(p.sizes || []), []), compareSizes);
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
      // hat fraction like "7 1/4" gets a Headwear group of its own.
      const sizeGroups = { Men: [], Women: [], Youth: [], Apparel: [], Headwear: [] };
      sizes.forEach(s => { sizeGroups[sizeCategory(s)].push(s); });
      const sizeGroupOrder = ['Men', 'Women', 'Youth', 'Apparel', 'Headwear'];
      $('sizeFilter').innerHTML = '<option value="">All Sizes</option>' +
        sizeGroupOrder.filter(g => sizeGroups[g].length).map(g =>
          '<optgroup label="' + g + '">' +
          sizeGroups[g].map(s => `<option value="${s}">${sizeDisplay(s)}</option>`).join('') +
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
        `<button type="button" class="brand-tile" data-mark="all" onclick="filterByBrand('', this)">` +
          `<span class="wm">All Brands</span></button>` +
        tiles.map((b, i) => {
          const has = inStock.some(s => s.toLowerCase() === b.toLowerCase());
          const m = brandMark(b);
          return `<button type="button" class="brand-tile${has ? '' : ' soon'}" data-mark="${m.mark}"` +
            `${m.len ? ` data-len="${m.len}"` : ''} onclick="filterByBrandAt(${i}, this)"` +
            `${has ? '' : ` aria-label="${esc(b)} — no pairs in stock yet"`}` +
            `><span class="wm">${m.wm}</span>${has ? '' : '<span class="tag">Soon</span>'}</button>`;
        }).join('');

      // Chips follow the stricter rule — only brands that can actually return a
      // result. A suggestion chip that finds nothing is the worst kind of dead end.
      $('searchChips').innerHTML = CATALOG_BRANDS.slice(0, 5).map((b, i) =>
        `<button type="button" onclick="setSearchBrand(${i})">${b}</button>`).join('');
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

    // Render Home Sections
    function renderHome() {
      $('trending').innerHTML = products.slice(0, 4).map(productCard).join('');
      $('recent').innerHTML = products.slice(-4).map(productCard).join('');
      $('clothing-accessories').innerHTML = products.filter(p => productCategory(p) === 'clothing').map(productCard).join('');
      $('random-shit').innerHTML = products.filter(p => productCategory(p) === 'random').map(productCard).join('');
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

    // Render Shop with Active Filters & Sorter
    function renderShop() {
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
        list = list.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
      }
      if (size) {
        list = list.filter(p => p.sizes.includes(size));
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
      const emptyCopy = brand && !list.length
        ? `No ${brand} items in stock yet — new stock goes up weekly.`
        : (sizeQuery
          ? `Nothing in ${sizeQuery.display} right now — try another size.`
          : (brand === 'Supreme' ? 'No clothing found matching those filters.' : 'No sneakers found matching those filters.'));

      $('shopProducts').innerHTML = list.length
        ? list.map(productCard).join('')
        : `<div style="grid-column: 1/-1; padding: 48px 0; text-align: center; color: var(--muted);"><p style="font-size: 16px; font-weight:700">${emptyCopy}</p><button class="btn light" style="margin-top:12px" onclick="clearFilters()">Reset All Filters</button></div>`;

      $('productTotal').textContent = list.length + ' ITEMS AVAILABLE';
      if ($('shopTitle')) $('shopTitle').textContent = CATEGORY_TITLES[shopCategoryFilter] || 'SHOP ALL';
      updateFilterCount();
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
      const n = ['brandFilter', 'sizeFilter', 'conditionFilter'].filter(id => $(id) && $(id).value).length;
      btn.textContent = n ? 'Filters (' + n + ')' : 'Filters';
    }

    function clearFilters() {
      ['filterSearch', 'mobileSearch', 'brandFilter', 'sizeFilter', 'conditionFilter'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      if ($('sort')) $('sort').value = 'featured';
      shopCategoryFilter = '';
      document.querySelectorAll('.brand-tile').forEach(t => t.classList.remove('selected'));
      renderShop();
    }

    // Brand Tile Click Handler
    function filterByBrand(brand, el) {
      document.querySelectorAll('.brand-tile').forEach(x => x.classList.remove('selected'));
      if (el) el.classList.add('selected');
      // Ignore a brand that isn't on the tile list at all, rather than silently
      // filtering to nothing. A brand that's listed but not yet stocked is a
      // different case — that one keeps its filter and explains itself below.
      const known = TILE_BRANDS.some(b => b.toLowerCase() === String(brand || '').toLowerCase());
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

    function urlFor(s) { return hashURL(s.page, s.pid, s.section); }

    // Write history with a real URL. Opaque origins (file://) reject pushState
    // URLs, so fall back to assigning location.hash — the router already ran.
    function writeHistory(mode, s, url) {
      const target = url || urlFor(s);
      try {
        if (mode === 'push') history.pushState(s, '', target);
        else history.replaceState(s, '', target);
        lastHash = location.hash;
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
      // Refreshed here rather than only when a listing renders: the phone order bar
      // names the pair while one is on screen, so leaving a listing has to take the
      // pair back off it.
      updateOrderBar();
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
      else document.title = 'Random Stock — Verified Sneakers';
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
      clearFilters();
      if (brand && brand !== 'all') {
        $('brandFilter').value = brand;
      }
      go('shop');
      renderShop();
    }

    function shopCategory(category) {
      clearFilters();
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
      selectedSize = current.sizes[0]; // initialize default selected size

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
        src,
        alt: singlePhoto ? current.name : current.name + ' angle ' + (i + 1)
      }));

      // Each shot is a button (see .gallery-shot): looking closer is the one thing a
      // buyer does here, and a bare <img> could only be clicked, never tabbed to or
      // opened from the keyboard.
      $('gallery').innerHTML = galleryList.map((shot, i) => `
        <button class="gallery-shot" type="button" onclick="zoomOpen(${i})"
                aria-label="Zoom in on ${esc(shot.alt)}">
          <img src="${shot.src}" alt="${esc(shot.alt)}" loading="lazy">
        </button>
      `).join('');

      const isSneaker = productCategory(current) === 'sneakers';
      const itemLabel = isSneaker ? 'pair' : 'item';
      const sizeLabel = 'Available sizes';
      const sizeAriaLabel = isSneaker ? 'Size US' : 'Size';
      const hasSizes = current.sizes.length > 0;

      $('details').innerHTML = `
        <span class="eyebrow">${current.brand}</span>
        <h1>${current.name}</h1>
        <p class="color" style="font-size:14px;color:var(--muted);margin:4px 0 16px">${current.color}</p>
        <div class="meta">
          SKU: ${current.sku}<br>
          CONDITION: ${current.condition}<br>
          PACKAGING: ${current.box || 'Original Box'}
        </div>
        ${current.details ? `<ul class="product-details">${current.details.map(d => `<li>${d}</li>`).join('')}</ul>` : ''}
        ${hasSizes ? `<div style="margin-top: 24px">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
            <span class="eyebrow" style="color:var(--ink); font-weight:700">${sizeLabel}</span>
            <span class="eyebrow">${sizeCategoryLabel(current)}</span>
          </div>
          <div class="size-grid">
            ${current.sizes.map((s, idx) => `
              <button class="size-btn ${idx === 0 ? 'selected' : ''}"
                      onclick="selectSize('${s}', this)"
                      aria-label="${sizeAriaLabel} ${s}">
                ${s}
              </button>
            `).join('')}
          </div>
        </div>` : ''}
        <div class="order-cta">
          <a class="btn" id="orderCall" href="tel:+19144821144">Call to order</a>
          <a class="btn light" id="orderText" href="sms:+19144821144">Text this ${itemLabel}</a>
        </div>
        <p class="order-note">${hasSizes ? `Sizes listed are what we hold right now. Call or text the ${itemLabel} and your size and we will confirm availability, condition and shipping.` : `Call or text about this ${itemLabel} and we will confirm availability, condition and shipping.`}</p>
        <div class="listing-qr" id="listingQr"></div>
        <div class="perks">
          <p>✓ <b>100% Authenticity Guaranteed:</b> Hand-inspected by verification specialists.</p>
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
        $('searchResults').innerHTML = matches.map(productCard).join('');
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
      const hash = location.hash || '#home';
      if (!force && hash === lastHash) return;    // already applied (popstate + hashchange)
      lastHash = hash;
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
      const route = parseHash(location.hash);
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
      if (!a || !a.hasAttribute('onclick')) return;
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

    renderFilterUI();
    renderHome();
    renderShop();

    // Then restore whatever the URL asked for (refresh, shared link, bookmark)
    hydrateFromURL();
