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

    const $ = id => document.getElementById(id);

    // ---- Cleanup pass helpers ----

    // Catalog sizes mix men's, women's and youth shoe runs ("10", "5.5W", "2Y",
    // "13K") with apparel letters ("S", "M", "L") and fitted-hat fractions
    // ("7 1/4"). Nothing else in the catalog reads like a bare letter or a spaced
    // fraction, so both are unambiguous and get groups of their own instead of being
    // passed off as men's shoe sizes.
    function sizeCategory(size) {
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
    function sizeDisplay(s) {
      const cat = sizeCategory(s);
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
      const cats = uniqSorted((product && product.sizes ? product.sizes : []).map(sizeCategory));
      if (!cats.length) return '';
      if (cats.length > 1) return 'Mixed sizing';
      return SIZING_LABELS[cats[0]] || 'Sizing';
    }

    // The size chips report what we hold; these links carry the pair and the chosen
    // size into the message so nobody has to retype a SKU.
    function updateOrderLinks() {
      const call = $('orderCall');
      const text = $('orderText');
      if (!call || !text || !current) return;
      const size = selectedSize || (current.sizes || [])[0] || '';
      const summary = current.name + ' (SKU ' + current.sku + ')' + (size ? ', size ' + sizeDisplay(size) : '');
      call.href = 'tel:+19144821144';
      text.href = 'sms:+19144821144?&body=' + encodeURIComponent('Hi Random Stock, is the ' + summary + ' still available?');
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
    const BRAND_TILES = ['Jordan', 'Nike', 'adidas', 'New Balance', 'ASICS', 'TRAVIS SCOTT', 'SUPREME'];

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
      uniqSorted(inStock).forEach(b => { if (tiles.indexOf(b) === -1) tiles.push(b); });
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
      $('brandGrid').innerHTML =
        `<button type="button" class="brand-tile" onclick="filterByBrand('', this)">All Brands</button>` +
        tiles.map((b, i) => {
          const has = inStock.some(s => s.toLowerCase() === b.toLowerCase());
          return `<button type="button" class="brand-tile${has ? '' : ' soon'}" ` +
            `onclick="filterByBrandAt(${i}, this)"` +
            `${has ? '' : ' aria-label="' + b + ' — no pairs in stock yet"'}` +
            `><span>${b}</span>${has ? '' : '<span class="tag">Soon</span>'}</button>`;
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
      const m = /^(?:us\s*)?(\d+(?:\.\d+)?)([a-z]*)$/i.exec(str);
      if (!m) return null;
      const value = parseFloat(m[1]);
      if (!Number.isFinite(value) || value > MAX_SIZE_QUERY) return null;
      return { value, suffix: m[2].toLowerCase(), letters: false, display: 'US ' + value };
    }

    // "11" matches any size worth 11. "5.5w" / "13k" only match that same run, since a
    // suffix means the shopper named a specific women's or kids' size rather than a number.
    // Letter queries ("m", "xl") match the exact apparel size.
    function matchesSize(product, sizeQuery) {
      return (product.sizes || []).some(s => {
        const st = String(s).trim();
        if (sizeQuery.letters) return st.toLowerCase() === sizeQuery.value;
        const parsed = /^(\d+(?:\.\d+)?)(.*)$/.exec(st);
        if (!parsed) return false;
        const value = parseFloat(parsed[1]);
        if (!Number.isFinite(value) || value !== sizeQuery.value) return false;
        const suffix = parsed[2].toLowerCase();
        return !sizeQuery.suffix && !suffix ? true : suffix === sizeQuery.suffix;
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

      const galleryImages = current.gallery && current.gallery.length
        ? current.gallery
        : [current.img, current.img, current.img, current.img];

      $('gallery').innerHTML = galleryImages.map((src, i) => `
        <img src="${src}" alt="${current.name} angle ${i + 1}" loading="lazy">
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

    function globalSearch() {
      const q = ($('globalSearch').value || '').trim().toLowerCase();
      if (!q) {
        $('searchResults').innerHTML = '';
        return;
      }
      const matches = products.filter(p => 
        (p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.sku).toLowerCase().includes(q)
      ).slice(0, 4);

      if (!matches.length) {
        $('searchResults').innerHTML = '<p style="grid-column: 1/-1; color: var(--muted); padding: 20px 0;">No matching sneakers found.</p>';
      } else {
        $('searchResults').innerHTML = matches.map(productCard).join('');
      }
    }

    function setSearch(term) {
      $('globalSearch').value = term;
      globalSearch();
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
