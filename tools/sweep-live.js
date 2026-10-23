#!/usr/bin/env node
/* tools/sweep-live.js — tap the shop the way a shopper does, in a real browser, against a
   real URL. Run: node tools/sweep-live.js [--base=…] [--width=390] [--retries=2]

   Why this exists at all, when every other suite reads the files instead of the page:

   On 23 Oct the six brand tiles the shop is known for — Supreme, Bearbrick, Huffy, MadCan,
   New Era, The North Face — came back with nothing and with the line "No Supreme items in
   stock yet — new stock goes up weekly", while eight Supreme tees sat in the catalog. The
   catalog was fine. `shopCategory()` left its category on `shopCategoryFilter`, nothing in
   the filter bar shows a category, and the tile handler only ever set a brand — so a shopper
   who tapped SHOP SNEAKERS, went home and then tapped Supreme got sneakers AND Supreme, i.e.
   nothing. Jordan, Nike, adidas and New Balance were unaffected because they are sneakers,
   which is exactly what made it look like a stock problem with six brands rather than a
   filter problem with one.

   No static suite could have caught it: every file was individually correct, and the whole
   catalog loaded fine on a cold page. The bug lived in the order two clicks were made in. So
   this sweep makes the clicks: each hero category first, then every tile, and it fails when
   a tile that has stock behind it answers with an empty grid. It runs after a Pages deploy
   (.github/workflows/live-sweep.yml) and by hand before a release.

   Dependency-free on purpose — this repo has no package.json and is not about to grow one.
   Headless Chrome is driven over the DevTools protocol with Node's built-in WebSocket
   (Node 22+); there is no puppeteer, no chromedriver and nothing to install.

   Exit codes: 0 every check passed · 1 a check failed · 2 the environment could not run it
   (no Chrome, no WebSocket, page never answered). Only 1 is a verdict about the site. */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- arguments -------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name, fallback) {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const BASE = String(opt('base', 'https://randomstock.shop/index.html'));
const WIDTH = Number(opt('width', 390));
const HEIGHT = Number(opt('height', WIDTH < 700 ? 844 : 900));
const RETRIES = Number(opt('retries', 0));
const RETRY_WAIT = Number(opt('retry-wait', 60)) * 1000;
const LOAD_TIMEOUT = Number(opt('load-timeout', 30)) * 1000;
const SWEEP_TIMEOUT = Number(opt('timeout', 180)) * 1000;
// The stamp the page is expected to be serving ("app.js?v=…"). Passing it makes the sweep a
// deploy check too: right after a push the CDN can still answer with the previous build for
// a few minutes, and sweeping that page would either fail for the wrong reason or, worse,
// pass without proving anything about the commit that just shipped.
const EXPECT_STAMP = String(opt('expect-stamp', '') || '');
const SHOT = opt('shot', '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


// ---- the sweep, which runs inside the page ---------------------------------------
// Written as a real function and stringified, so `node --check` parses it and a typo is a
// syntax error at author time rather than at 3am in CI. It may not reference anything
// outside itself: it is serialised and evaluated in Chrome.
async function sweepInPage() {
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });

  const one = (sel) => document.querySelector(sel);
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const text = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const cards = () => all('#shopProducts .product');
  const cardBrand = (c) => text(c.querySelector('.brand')).toLowerCase();
  const title = () => text(one('#shopTitle'));
  const total = () => text(one('#productTotal'));
  const emptyCopy = () => text(one('#shopProducts .empty-state'));
  const brandValue = () => String((one('#brandFilter') || {}).value || '');
  const shopVisible = () => {
    const view = one('#view-shop');
    return !!view && view.classList.contains('active');
  };
  // One frame pair plus a tick: renderShop writes the grid synchronously and showPage swaps
  // classes synchronously, so the only thing worth waiting for is the frame after the paint.
  // (The flake that made my first probe lie was scrolling to lazy images, not the grid.)
  // Kept deliberately small — this runs ~100 times per sweep, and a sweep that outlives a
  // maintainer's shell is a sweep nobody runs.
  const settle = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleepMs(16);
  };
  const goHome = async () => {
    const logo = one('.logo');
    if (logo) logo.click();
    await settle();
  };
  const optionBrands = () => all('#brandFilter option').map((o) => String(o.value || ''));
  // data-arg is an index, not a name — tiles go through `filterByBrandAt(i)` so a brand with
  // an apostrophe cannot break out of an inline handler — and the wordmark is stylised
  // ("TRAVISSCOTT" has no space in it), so neither recovers the brand a click filters by.
  // The dropdown is filled from the same TILE_BRANDS list, in the same order, so the option
  // after "All Brands" is tile i's real name. A grid and a dropdown that disagree would
  // filter something other than the tile that was tapped, which L4 asserts on its own.
  const tiles = () => {
    const names = optionBrands();
    return all('#brandGrid .brand-tile').map((t) => {
      const isAll = t.getAttribute('data-mark') === 'all';
      const i = Number(t.getAttribute('data-arg'));
      return {
        brand: isAll ? '' : String(names[i + 1] || ''),
        all: isAll,
        soon: t.classList.contains('soon'),
        el: t
      };
    });
  };
  const clickTile = async (brand, isAll) => {
    const hit = tiles().find((t) => (isAll ? t.all : t.brand.toLowerCase() === String(brand).toLowerCase()));
    if (!hit) return false;
    hit.el.click();
    await settle();
    return true;
  };
  const setSearch = async (value) => {
    const box = one('#filterSearch') || one('#mobileSearch');
    if (!box) return false;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    return true;
  };
  const setBrandSelect = async (brand) => {
    const sel = one('#brandFilter');
    if (!sel) return false;
    const target = all('#brandFilter option').find((o) => o.value && o.value.toLowerCase() === String(brand).toLowerCase());
    sel.value = target ? target.value : '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return !!target;
  };
  const names = (list) => Array.from(new Set(list)).join(' | ');

  // L. the page itself ------------------------------------------------------------
  add('L1  the page boots with a brand grid to tap', tiles().length >= 10, tiles().length + ' tiles');
  add('L2  the shop starts on the home view', !shopVisible(), 'shop active: ' + shopVisible());
  const stampSrc = (one('script[src*="app.js"]') || {}).src || '';
  const stamp = (/app\.js\?v=[a-f0-9]+/.exec(stampSrc) || [''])[0];
  const shelf = tiles();
  add('L3  the six brands the shop is known for are on the grid',
    ['Supreme', 'Bearbrick', 'Huffy', 'MadCan', 'New Era', 'The North Face']
      .every((b) => shelf.some((t) => t.brand.toLowerCase() === b.toLowerCase())),
    shelf.map((t) => t.brand || '(all)').join(', '));
  const gridNames = shelf.map((t) => t.brand.toLowerCase());
  const optNames = optionBrands().map((v) => v.toLowerCase());
  add('L4  the grid and the brand dropdown name the same brands in the same order',
    gridNames.length === optNames.length && gridNames.every((n, i) => n === optNames[i]),
    'grid: ' + gridNames.join(', ') + ' / dropdown: ' + optNames.join(', '));

  // T. every tile from a cold page — the path that always worked -------------------
  for (const tile of shelf) {
    const label = tile.brand || 'All Brands';
    const opened = await clickTile(tile.brand, tile.all);
    if (!opened) {
      add('T:' + label + ' opens', false, 'tile not found');
      await goHome();
      continue;
    }
    const n = cards().length;
    const brands = names(cards().map(cardBrand));
    const okShop = shopVisible();
    const okTitle = title() === 'THE VAULT';
    add('T:' + label + ' answers with its own stock',
      okShop && okTitle && (tile.soon ? n === 0 : n > 0),
      'cards=' + n + ' title=' + JSON.stringify(title()) + ' shop=' + okShop + ' total=' + JSON.stringify(total()));
    if (!tile.soon && !tile.all) {
      // Non-zero is not enough: the grid has to be *this* brand, otherwise a stale filter
      // that happens to match something else would pass this check.
      add('T:' + label + ' shows only ' + label,
        n > 0 && brands === tile.brand.toLowerCase(),
        'brands in grid: ' + (brands || '(none)'));
    }
    if (tile.soon) {
      add('T:' + label + ' says no stock yet, not "filtered out"',
        /in stock yet/i.test(emptyCopy()) && !/matched those filters/i.test(emptyCopy()),
        'copy: ' + JSON.stringify(emptyCopy()));
    }
    await goHome();
  }

  // C. the bug: a category first, then a tile ------------------------------------
  // shopCategoryFilter has no control in the filter bar, so any tile that inherits it is
  // answering a question the shopper cannot see, let alone clear.
  const seenCat = {};
  const categoryTiles = all('[data-act="shopCategory"]').filter((el) => {
    const arg = el.getAttribute('data-arg') || '';
    if (!arg || seenCat[arg]) return false;
    seenCat[arg] = true;
    return true;
  });
  add('C0  the hero offers categories to tap', categoryTiles.length >= 1, categoryTiles.length + ' categories');

  for (const catTile of categoryTiles) {
    const cat = catTile.getAttribute('data-arg');
    await goHome();
    const fresh = all('[data-act="shopCategory"]').find((el) => el.getAttribute('data-arg') === cat);
    if (!fresh) { add('C:' + cat + ' opens', false, 'category tile missing'); continue; }
    fresh.click();
    await settle();
    const catCards = cards().length;
    const catTitle = title();
    add('C:' + cat + ' opens a filled shop of its own',
      shopVisible() && catCards > 0 && catTitle && catTitle !== 'THE VAULT',
      'cards=' + catCards + ' title=' + JSON.stringify(catTitle));

    // then every tile, which is where the six brands used to vanish
    for (const tile of tiles()) {
      const label = tile.brand || 'All Brands';
      await goHome();
      const opened = await clickTile(tile.brand, tile.all);
      if (!opened) { add('C:' + cat + ' -> ' + label, false, 'tile vanished'); continue; }
      const n = cards().length;
      const brands = names(cards().map(cardBrand));
      const stillCategory = title() !== 'THE VAULT';
      add('C:' + cat + ' -> ' + label + ' is not held to ' + cat,
        shopVisible() && !stillCategory && (tile.soon ? n === 0 : n > 0),
        'cards=' + n + ' title=' + JSON.stringify(title()) + (tile.soon ? ' (no stock yet)' : ''));
      if (!tile.soon && !tile.all) {
        add('C:' + cat + ' -> ' + label + ' carries only ' + label,
          n > 0 && brands === tile.brand.toLowerCase(),
          'brands in grid: ' + (brands || '(none)'));
      }
      const select = brandValue().toLowerCase();
      add('C:' + cat + ' -> ' + label + ' hands the same answer to the brand control',
        select === String(tile.brand || '').toLowerCase(),
        'brand control: ' + JSON.stringify(brandValue()));
    }
  }

  // S. what the empty shelf is allowed to claim ----------------------------------
  await goHome();
  const stocked = shelf.find((t) => !t.all && !t.soon);
  const planned = shelf.find((t) => t.soon);
  if (stocked) {
    await clickTile(stocked.brand, false);
    const full = cards().length;
    await setSearch('zzzzzz');
    const zero = cards().length;
    const copy = emptyCopy();
    add('S1  a stocked brand filtered to nothing blames the filter, not the shelf',
      full > 0 && zero === 0 && /matched those filters/i.test(copy) && !/in stock yet/i.test(copy),
      'full=' + full + ' filtered=' + zero + ' copy=' + JSON.stringify(copy));
  } else {
    add('S1  a stocked brand filtered to nothing blames the filter, not the shelf', false, 'no stocked tile found');
  }
  if (planned) {
    await goHome();
    // S1 left a search in the box; a shopper arriving at a brand that has nothing would not
    // have that, and carrying it over would make this check measure the wrong thing.
    await setSearch('');
    const picked = await setBrandSelect(planned.brand);
    const n = cards().length;
    add('S3  a brand with no stock still gets its own line',
      picked && n === 0 && /in stock yet/i.test(emptyCopy()) && !/matched those filters/i.test(emptyCopy()),
      (picked ? '' : 'no option for ' + planned.brand + ' ') + 'cards=' + n + ' copy: ' + JSON.stringify(emptyCopy()));
  } else {
    add('S3  a brand with no stock still gets its own line', true, 'no planned-only tile today');
  }

  await goHome();
  return {
    base: typeof location !== 'undefined' ? location.href : '',
    width: window.innerWidth,
    stamp,
    stampSrc,
    tiles: shelf.map((t) => (t.brand || '(all)') + (t.soon ? ' [soon]' : '')),
    checks
  };
}

// ---- CDP driver -------------------------------------------------------------------
// Chrome is found by name, because CI has google-chrome while a desktop may have chromium
// and a snap may be somewhere else again. Polling /json/list rather than parsing stderr
// keeps this free of log-format assumptions.
function chromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ];
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    // a bare name is resolved by PATH; check the usual dirs so a missing one does not cost a
    // spawn attempt per candidate
    const hit = (process.env.PATH || '').split(path.delimiter)
      .map((dir) => path.join(dir, c))
      .find((full) => { try { return fs.existsSync(full); } catch (e) { return false; } });
    if (hit) return hit;
  }
  return null;
}

async function sweepOnce(url) {
  const bin = chromeBinary();
  if (!bin) throw new Error('no Chrome/Chromium found — set CHROME_BIN');
  if (typeof WebSocket === 'undefined') {
    throw new Error('global WebSocket missing — this needs Node 22+ (DevTools over raw WebSocket, no puppeteer)');
  }

  const PORT = 9333 + (process.pid % 200) + Math.floor(Math.random() * 40);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rareform-sweep-'));
  const proc = spawn(bin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--hide-scrollbars',
    '--window-size=' + WIDTH + ',' + HEIGHT,
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userData,
    'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    let target = null;
    for (let i = 0; i < Math.ceil(LOAD_TIMEOUT / 250) && !target; i++) {
      await sleep(250);
      try {
        const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
        if (res.ok) {
          const list = await res.json();
          target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        }
      } catch (e) { /* not up yet */ }
    }
    if (!target) throw new Error('Chrome never opened a devtools page');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    const send = (method, params) => new Promise((res, rej) => {
      const mid = ++id;
      // The whole sweep runs inside one Runtime.evaluate, so that call needs the sweep
      // budget; everything else is a single protocol round-trip and 20s means it hung.
      const budget = method === 'Runtime.evaluate' ? SWEEP_TIMEOUT : 20000;
      const timer = setTimeout(() => { pending.delete(mid); rej(new Error('devtools timeout: ' + method)); }, budget);
      pending.set(mid, {
        method,
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); }
      });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const events = [];
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('devtools socket never opened')), 10000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); });
      ws.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('devtools socket error')); });
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          // A protocol-level failure (no execution context, page gone) used to arrive as an
          // empty result and then blow up as "cannot read property of undefined" three lines
          // later. Reporting Chrome's own words costs one branch and saves the hunt.
          if (msg.error) p.rej(new Error(p.method + ': ' + (msg.error.message || 'failed')));
          else p.res(msg.result || {});
        } else if (msg.method) {
          events.push(msg.method);
        }
      } catch (e) { /* ignore malformed frames */ }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    // The width is the point: a phone is where the tiles are tapped, and the filter bar moves
    // into a drawer there, so the sweep runs at both ends and the desktop pass is the one that
    // proves the sidebar and the grid agree.
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: WIDTH < 700 ? 2 : 1, mobile: WIDTH < 700
    });

    const nav = await send('Page.navigate', { url });
    if (nav && nav.errorText) throw new Error('navigation failed: ' + nav.errorText);
    for (let i = 0; i < Math.ceil(LOAD_TIMEOUT / 250); i++) {
      await sleep(250);
      if (events.includes('Page.loadEventFired')) break;
    }
    await sleep(1200);   // let the deferred boot script place the grid

    const out = await send('Runtime.evaluate', {
      expression: '(' + sweepInPage.toString() + ')()',
      awaitPromise: true,
      returnByValue: true
    });
    if (out.exceptionDetails) {
      const d = out.exceptionDetails;
      throw new Error('sweep threw in the page: ' + (d.exception ? d.exception.description || d.text : d.text));
    }
    if (!out || !out.result) throw new Error('the page never returned a verdict (did it navigate away?)');

    if (SHOT) {
      try {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        if (shot && shot.data) {
          fs.mkdirSync(path.dirname(path.resolve(SHOT)), { recursive: true });
          fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
        }
      } catch (e) { /* a screenshot is a courtesy, never the verdict */ }
    }

    return out.result.value;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill('SIGKILL'); } catch (e) {}
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) {}
  }
}

// ---- run --------------------------------------------------------------------------
const stampOf = (s) => (/app\.js\?v=[a-f0-9]+/.exec(String(s)) || [''])[0];

function report(result) {
  const checks = result.checks.slice();
  const live = stampOf(result.stamp || '');
  if (EXPECT_STAMP) {
    const want = stampOf(EXPECT_STAMP) || String(EXPECT_STAMP);
    checks.push({
      name: 'L5  the live page is the build under test',
      pass: !!live && live === want,
      detail: 'live=' + (live || '(no stamp)') + ' expected=' + want +
        (live === want ? '' : ' — the CDN may still be serving the previous deploy')
    });
  }
  console.log('');
  console.log('swept ' + result.base.replace(/\?.*$/, '') + ' at ' + result.width + 'px');
  console.log('tiles ' + result.tiles.join(', '));
  checks.forEach((c) => console.log((c.pass ? 'PASS  ' : 'FAIL  ') + c.name + (c.pass ? '' : '   [' + c.detail + ']')));
  const fails = checks.filter((c) => !c.pass);
  console.log('TOTAL=' + checks.length + ' FAIL=' + fails.length);
  return fails;
}

// Races a promise against a deadline and always clears the timer. Without the clearTimeout
// the timer keeps Node's event loop alive after a fast sweep, and the rejection it throws on
// a slow one has nobody listening to it.
function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function main() {
  console.log('sweep-live: ' + BASE + ' at ' + WIDTH + 'px' + (EXPECT_STAMP ? ' expecting ' + stampOf(EXPECT_STAMP) : ''));
  let lastFails = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) {
      // A deploy is not visible the instant the workflow finishes: Pages and its CDN keep the
      // old copy for a while. Retrying the whole sweep is what turns that into a slow pass
      // instead of a red build that means nothing.
      console.log('\nattempt ' + (attempt + 1) + ' of ' + (RETRIES + 1) + ' — waiting ' + (RETRY_WAIT / 1000) + 's first');
      await sleep(RETRY_WAIT);
    }
    let result;
    try {
      result = await withDeadline(sweepOnce(BASE), SWEEP_TIMEOUT,
        'the sweep did not finish in ' + (SWEEP_TIMEOUT / 1000) + 's');
    } catch (e) {
      console.error('could not sweep: ' + e.message);
      lastFails = null;
      continue;
    }
    lastFails = report(result);
    if (!lastFails.length) process.exit(0);
  }
  if (lastFails === null) {
    console.error('\nno verdict: the page could not be swept at all (environment, not the shop)');
    process.exit(2);
  }
  // A page with no brand grid is not the shop answering wrongly — it is the wrong page (a
  // 404, a CDN error, a mistyped URL). Calling that a site failure would train the reader to
  // ignore this check, which is worse than not having it.
  if (lastFails.some((c) => /^L1 /.test(c.name))) {
    console.error('\nno verdict: that URL did not serve the shop (no brand grid at ' + BASE + ')');
    process.exit(2);
  }
  console.error('\nthe shop failed the sweep — ' + lastFails.length + ' check(s) above');
  process.exit(1);
}

main().catch((e) => {
  console.error('sweep-live error: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});

