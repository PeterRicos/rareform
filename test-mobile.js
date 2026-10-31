/* Static phone-contract harness for index.html + styles.css + app.js (same folder)
   Run: node test-mobile.js     (or: node randomstock/test-mobile.js)

   Most shoppers arrive here on a phone, and a phone is the one browser we cannot
   open from the build. So this suite pins the handful of rules that, if a later
   edit drops them, break the storefront on a handset in ways a desktop window
   never shows:

     - the viewport asks for the device width and leaves pinch-zoom unlocked.
       Locking the zoom is the other way people "fix" the field zoom below, and it
       costs a low-vision shopper the only magnifier they have.
     - the hero clip carries what iOS needs to play inline (muted, playsinline,
       autoplay) with preload="metadata", and the still image stays underneath so a
       clip that never arrives leaves a photo, not a black box.
     - the listing QR code stays off a phone's screen: a phone cannot scan itself,
       and the Text button already opens Messages. The reveal must live behind a
       hover/pointer media query, and app.js must ask the same question when it
       decides whether to open the desktop order dialog.
     - no field on the phone layout sits under 16px. iOS Safari zooms the page in
       when one takes focus and does not zoom back out.
     - the shop's filters, its search box and its sort menu exist and are reachable
       at phone widths, where the sidebar is gone.
     - the listing page stops pinning its details column and stops sizing the hero
       against 100vh, both of which are wrong once a URL bar is in the way.
     - the controls a thumb has to hit stay at their documented minimum sizes, and the
       announcement bar gives up its own copy (shipping line, then the tail of the
       claim, then a single wrap) before any of it leaves the screen.
     - the order bar gave a phone a persistent call/text path it never
       had: off on a desktop, on below 820px, clear of the page it covers, and built
       from the same tel:/sms: links everything else hands to the phone.

   Everything here is read out of the shipped files, so it runs anywhere Node runs. */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const structuredData = require('./jsonld.js');


// Rules are read out of a comment-free copy: a /* ... */ block sitting between two
// rules would otherwise be glued onto the next selector and that rule would look
// missing. The raw text is still what the "does this string appear" checks use.
const CSS = css.replace(/\/\*[\s\S]*?\*\//g, '');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });

// ---- tiny CSS readers: enough for "what does <selector> say inside <media query>" ----
const flat = (s) => s.replace(/\s+/g, ' ');

// Body of every @media block whose query contains `query` (nesting-aware).
function media(query) {
  const want = flat(query);
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    if (flat(m[1]).indexOf(want) < 0) continue;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
      i++;
    }
    out.push(CSS.slice(m.index + m[0].length, i - 1));
  }
  return out.join('\n');
}

// Declarations of every rule whose selector list contains `sel` exactly, joined in
// source order. Several rules legitimately mention the same selector (a base size
// and a later phone override), and reading only the first one would report a rule
// as missing when the browser is in fact applying the later declaration.
function decls(src, sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sels = m[1].split(',').map((s) => flat(s).trim());
    if (sels.indexOf(sel) >= 0) out.push(flat(m[2]));
  }
  return out.length ? out.join(' ; ') : null;
}

// The value the browser ends up with: the last one declared.
const prop = (src, sel, name) => {
  const d = decls(src, sel);
  if (d === null) return null;
  const re = new RegExp('(?:^|;)\\s*' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+)', 'g');
  let m;
  let value = null;
  while ((m = re.exec(d))) value = m[1].trim();
  return value;
};
const hasRule = (src, sel) => decls(src, sel) !== null;

const M820 = media('max-width: 820px');
const M860 = media('max-width: 860px');
const M600 = media('max-width: 600px');
const M480 = media('max-width: 480px');
const M1024 = media('max-width: 1024px');
const HOVER = media('hover: hover');
const REDUCED = media('prefers-reduced-motion: reduce');

const PX = (v) => { const m = String(v || '').match(/^([\d.]+)px$/); return m ? Number(m[1]) : NaN; };
const find = (re, src) => { const m = String(src || '').match(re); return m ? m[0] : null; };

// The sheet with every @media block removed: what a phone-agnostic reader would call
// the default. Without this, a "hidden by default" rule reads as its phone override,
// because that override is later in the file and later is what wins.
function stripMedia(src) {
  const re = /@media[^{]+\{/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += src.slice(last, m.index);
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    last = i;
  }
  return out + src.slice(last);
}
const BASE = stripMedia(CSS);

// ---- A. the document asks to be laid out like a phone -----------------------
const meta = (html.match(/<meta[^>]*name="viewport"[^>]*>/) || [''])[0];
ok('A1  viewport meta asks for the device width', /content="[^"]*width=device-width/.test(meta), meta || 'no viewport meta');
ok('A2  pinch-zoom is left unlocked for low-vision shoppers',
  meta.length > 0 && !/maximum-scale|user-scalable\s*=\s*no/.test(meta), meta);

const vid = (html.match(/<video class="hero-video"[\s\S]*?>/) || [''])[0];
ok('A3  hero clip is muted + playsinline + autoplay (the only combination iOS plays inline)',
  ['muted', 'playsinline', 'autoplay'].every((a) => new RegExp('\\b' + a + '\\b').test(vid)), vid);
ok('A4  hero clip preloads metadata only, not 1.7MB of video on a phone plan',
  /preload="metadata"/.test(vid), vid);
// The still is gone: the owner asked 2026-10-30 to remove the Jordan photo because it
// showed while the clip was still loading. The hero-image block now carries the clip
// alone, and the panel's #cfceca background is what shows until the clip fades in.
// So this pins the absence directly: no hero photo URL anywhere in the page, and the
// clip still present in the hero block.
ok('A5  no hero still photo anywhere in the page: the clip is the only visual layer',
  !/images\/hero-[0-9]+\.(avif|webp|jpg)/.test(html) &&
  /class="hero-image"[\s\S]*?<video class="hero-video"/.test(html));
ok('A6  app.js fades the clip in only once it decodes, and out again on error',
  /addEventListener\('loadeddata',\s*show\)/.test(app) && /addEventListener\('canplay',\s*show\)/.test(app) && /addEventListener\('error',\s*hide\)/.test(app));
ok('A7  reduced-motion users get the blank panel, not the clip (no still any more)',
  /\.hero-video\s*\{\s*display:\s*none\s*!important/.test(REDUCED));

// ---- B. the listing QR code stays off a phone's screen ----------------------
ok('B1  the QR block is hidden by default', prop(BASE, '.listing-qr', 'display') === 'none', prop(BASE, '.listing-qr', 'display'));
ok('B2  the only rule that reveals it is a hover/pointer query',
  prop(HOVER, '.listing-qr', 'display') === 'flex', HOVER ? flat(HOVER).slice(0, 90) : 'no hover/pointer block');
ok('B3  no width-based block turns it back on for a phone',
  !hasRule(M820, '.listing-qr') && !hasRule(M480, '.listing-qr') && !hasRule(M1024, '.listing-qr'),
  (hasRule(M820, '.listing-qr') ? 'max-width 820px sets .listing-qr' : '') + (hasRule(M480, '.listing-qr') ? ' max-width 480px sets .listing-qr' : ''));
const FINE = '(hover: hover) and (pointer: fine)';
ok('B4  app.js asks the same question of the same media query', app.indexOf("'" + FINE + "'") >= 0 || app.indexOf('"' + FINE + '"') >= 0);
ok('B5  the two files cannot drift apart on that query', css.indexOf(FINE) >= 0 && app.indexOf(FINE) >= 0);
ok('B6  on a phone the order dialog is skipped so the link opens Messages/the dialer',
  /function phoneHandlesLinks\(\)\s*\{\s*return\s*!\(fineMouseQuery\s*&&\s*fineMouseQuery\.matches\);/.test(app)
  && /if\s*\(phoneHandlesLinks\(\)\)\s*return;/.test(app));
ok('B7  the listing still carries both links the phone hands off from',
  /id="orderCall" href="tel:/.test(app) && /id="orderText" href="sms:/.test(app));

// ---- C. no field under 16px, or iOS zooms the page and stays zoomed ---------
['.shop-actions input', '.shop-actions select', '.filter input', '.filter select'].forEach((sel, i) => {
  ok('C' + (i + 1) + '  ' + sel + ' is 16px at phone widths',
    PX(prop(M820, sel, 'font-size')) >= 16, 'font-size: ' + prop(M820, sel, 'font-size'));
});
ok('C5  the desktop fields keep their 13px',
  PX(prop(BASE, '.shop-actions input', 'font-size')) === 13 && PX(prop(BASE, '.shop-actions select', 'font-size')) === 13 && PX(prop(BASE, '.filter select', 'font-size')) === 13,
  prop(BASE, '.shop-actions input', 'font-size') + ' / ' + prop(BASE, '.shop-actions select', 'font-size') + ' / ' + prop(BASE, '.filter select', 'font-size'));
ok('C6  the search overlay field is already over the threshold',
  !!find(/\.search-bar input\s*\{[^}]*font-size:\s*clamp\(\s*26px/, css), prop(CSS, '.search-bar input', 'font-size'));

// ---- D. the shop survives without its sidebar ------------------------------
ok('D1  the filter panel is closed by default on a phone', prop(M820, '.filters', 'display') === 'none', prop(M820, '.filters', 'display'));
ok('D2  and the toggle opens it as a grid', prop(M820, '.filters.open', 'display') === 'grid', prop(M820, '.filters.open', 'display'));
ok('D3  the toggle itself is phone-only', prop(BASE, '.filter-toggle', 'display') === 'none' && prop(M820, '.filter-toggle', 'display') === 'inline-flex',
  'base=' + prop(BASE, '.filter-toggle', 'display') + ' phone=' + prop(M820, '.filter-toggle', 'display'));
ok('D4  the phone search box is hidden on desktop and shown on a phone',
  prop(BASE, '#mobileSearch', 'display') === 'none' && prop(M820, '#mobileSearch', 'display') === 'block',
  'base=' + prop(BASE, '#mobileSearch', 'display') + ' phone=' + prop(M820, '#mobileSearch', 'display'));
ok('D5  the sidebar search field is dropped on a phone so there is only one',
  prop(M820, '.filters .filter:first-child', 'display') === 'none');
ok('D6  the sidebar layout collapses to one column', prop(M820, '.shop-layout', 'grid-template-columns') === '1fr');

// ---- E. the listing page re-flows -----------------------------------------
ok('E1  the detail grid collapses to one column', prop(M820, '.detail', 'grid-template-columns') === '1fr');
ok('E2  the details column stops being pinned to the viewport',
  prop(BASE, '.details', 'position') === 'sticky' && prop(M820, '.details', 'position') === 'static',
  'base=' + prop(BASE, '.details', 'position') + ' phone=' + prop(M820, '.details', 'position'));
ok('E3  the gallery tightens up', PX(prop(M820, '.gallery', 'gap')) <= 8, prop(M820, '.gallery', 'gap'));
ok('E4  the two order buttons stack on the smallest phones', prop(M480, '.order-cta', 'grid-template-columns') === '1fr');

// ---- F. the hero must not be sized against a mobile URL bar -----------------
ok('F1  the hero stops using 100vh on a phone',
  String(prop(BASE, '.hero', 'min-height')).indexOf('100vh') >= 0 && prop(M820, '.hero', 'min-height') === 'auto',
  'base=' + prop(BASE, '.hero', 'min-height') + ' phone=' + prop(M820, '.hero', 'min-height'));
ok('F2  full-height overlays use dvh so they fit with the URL bar showing',
  String(prop(BASE, '.mobile-drawer', 'height')).indexOf('dvh') >= 0 && String(prop(BASE, '.order-modal', 'max-height')).indexOf('dvh') >= 0,
  'drawer height=' + prop(BASE, '.mobile-drawer', 'height') + ' modal max-height=' + prop(BASE, '.order-modal', 'max-height'));

// ---- G. thumb-sized controls ------------------------------------------------
ok('G1  the header icon buttons are 44px in both directions',
  PX(prop(BASE, '.icon-btn', 'min-width')) >= 44 && PX(prop(BASE, '.icon-btn', 'min-height')) >= 44,
  prop(BASE, '.icon-btn', 'min-width') + ' x ' + prop(BASE, '.icon-btn', 'min-height'));
ok('G2  the hamburger is 44px on a phone',
  PX(prop(M820, '.hamb', 'min-width')) >= 44 && PX(prop(M820, '.hamb', 'min-height')) >= 44,
  prop(M820, '.hamb', 'min-width') + ' x ' + prop(M820, '.hamb', 'min-height'));
ok('G3  footer links clear the 24px floor (WCAG 2.5.8)', /\.foot-grid a\s*\{\s*line-height:\s*24px/.test(css));
ok('G4  the announcement dismiss button keeps its 40px hit area',
  PX(prop(BASE, '.announce button', 'min-width')) >= 40 && PX(prop(BASE, '.announce button', 'min-height')) >= 40,
  prop(BASE, '.announce button', 'min-width') + ' x ' + prop(BASE, '.announce button', 'min-height'));

// ---- H. the grids ---------------------------------------------------------------
ok('H1  product grids are 2-up on a phone', prop(M820, '.products', 'grid-template-columns') === 'repeat(2, 1fr)');
// The smallest phones used to drop to one card across, which turned a 102-item
// catalog into a very long scroll. Two across at 390px is still readable — a
// card is about 170px wide, the photo stays square, the name stays two lines —
// so the grid stays two-up here, with tighter gaps and padding to keep it
// compact. This deliberately reverses the earlier 1-up rule.
ok('H2  and 2-up on the smallest ones, compact', prop(M480, '.products', 'grid-template-columns') === 'repeat(2, 1fr)'
  && prop(M480, '.products', 'gap') === '10px'
  && prop(M480, '.p-info', 'padding') === '10px',
  prop(M480, '.products', 'grid-template-columns') + ' gap=' + prop(M480, '.products', 'gap'));
// The sort menu shared a row with the size filter and the filter toggle, so at
// 390px "Sort: Featured" clipped to "Sort: Fe,". The option text is now just
// "Featured" — the select's aria-label still says "Sort products" — and the
// sort control takes a double share of the row at the smallest widths.
ok('H2b sort option text is short, and the sort control takes a double share',
  /<option value="featured">Featured<\/option>/.test(html)
    && /<option value="new">Newest First<\/option>/.test(html)
    && prop(M480, '.shop-actions #sort', 'flex') === '2 1 0',
  prop(M480, '.shop-actions #sort', 'flex'));
// A closed drawer or search modal is not hidden by being parked off-screen:
// a transform leaves it in the tab order and in the accessibility tree. Both
// panels therefore hide with visibility (delayed to the end of the slide-out,
// like the order modal already did) and start aria-hidden, with app.js flipping
// aria-hidden on open and close.
ok('H4  closed drawer and search modal hide with visibility, not just a transform',
  prop(BASE, '.mobile-drawer', 'visibility') === 'hidden'
    && prop(BASE, '.mobile-drawer.open', 'visibility') === 'visible'
    && prop(BASE, '.search-modal', 'visibility') === 'hidden'
    && prop(BASE, '.search-modal.open', 'visibility') === 'visible',
  'drawer=' + prop(BASE, '.mobile-drawer', 'visibility') + ' modal=' + prop(BASE, '.search-modal', 'visibility'));
ok('H5  drawer and search modal start aria-hidden, and app.js flips them',
  /id="mobileDrawer"[^>]*aria-hidden="true"/.test(html)
    && /id="searchModal"[^>]*aria-hidden="true"/.test(html)
    && /\$\('mobileDrawer'\)\.setAttribute\('aria-hidden', 'false'\)/.test(app)
    && /\$\('searchModal'\)\.setAttribute\('aria-hidden', 'false'\)/.test(app)
    && /\$\('mobileDrawer'\)\.setAttribute\('aria-hidden', 'true'\)/.test(app)
    && /\$\('searchModal'\)\.setAttribute\('aria-hidden', 'true'\)/.test(app));
// The brand grid is no longer a fixed 8/4/2 column ladder. "Six roadmap brands plus
// 'All Brands' plus every other brand the catalog carries" is not a count that divides
// into eight, so the last row stopped short and left a hole where two tiles would have
// been. auto-fit holds the same 150px floor and takes the columns from the room it has,
// which is what lands two across a phone and four across a tablet — so what has to stay
// true is that the floor is there, and that no breakpoint has gone back to naming a
// count that has to be kept in sync with the catalog by hand.
ok('H3  brand tiles size themselves to the row (150px floor, no fixed column count)',
  prop(BASE, '.brand-grid', 'grid-template-columns') === 'repeat(auto-fit, minmax(150px, 1fr))'
  && prop(M1024, '.brand-grid', 'grid-template-columns') === null
  && prop(M820, '.brand-grid', 'grid-template-columns') === null,
  'base=' + prop(BASE, '.brand-grid', 'grid-template-columns')
  + ' 1024=' + prop(M1024, '.brand-grid', 'grid-template-columns')
  + ' 820=' + prop(M820, '.brand-grid', 'grid-template-columns'));

// ---- I. the dismissed announcement stays dismissed --------------------------
ok('I1  index.html re-applies the dismissal before the bar is parsed',
  /localStorage\.getItem\("randomstock\.announceDismissed"\)/.test(html));
ok('I2  and app.js writes the same key',
  /ANNOUNCE_KEY\s*=\s*'randomstock\.announceDismissed'/.test(app));

// ---- J. there is no fixed bottom bar -----------------------------------------
// A sticky CALL / TEXT bar lived here for one commit and came back out on
// the owner's call: over the bottom of a phone it crowded the listing's own Call and
// Text buttons and the footer links, which already do the same job from inside the
// page instead of on top of it. So what has to hold now is that it cannot creep back
// in unnoticed, and that index.html still carries no number.
ok('J1  no fixed order bar ships in the markup',
  !/class="order-bar"/.test(html) && !/id="bar(Call|Text|Wa)"/.test(html),
  'order bar markup found in index.html');
ok('J2  and no rules or wiring for one are left in the CSS or app.js',
  !/order-bar/.test(css) && !/updateOrderBar/.test(app),
  'order bar rules or wiring still present');
// Exception since 2026-10-24: the announcement bar's <noscript> fallback may carry
// the number (test-privacy.js P8) — the check below reads the markup with those
// blocks removed, so a literal anywhere else still fails.
ok('J3  the number is never written into the markup outside the noscript fallback — shoppers get it from app.js',
  html.replace(/<noscript[\s\S]*?<\/noscript>/g, '').indexOf(structuredData.PHONE) === -1
  && html.replace(/<noscript[\s\S]*?<\/noscript>/g, '').indexOf(structuredData.PHONE_DISPLAY) === -1,
  'plaintext number found in index.html outside noscript');

// ---- K. the announcement bar fits the screen it is on ------------------------
// The bar is one line of monospace that cannot reflow, and it is the first thing a
// shopper sees. Measured in headless Chrome before this was fixed: the claim with its
// tail is 361px, and a 390px phone gives the bar 316px between its padding once the 44px
// dismiss cross is cleared — the centred sentence hung 15px off the left edge (45px at
// 360px) and "NO CART" was off the screen. Higher up it was worse in a different way: at
// 640px the claim plus the shipping line spilled 679px into a 576px content box and
// dragged the document sideways, and at 821px the full desktop line still clipped 769px
// into 757px. What has to stay true is the order it gives up room: shipping line first,
// then the tail of the claim, then it wraps — never off the screen, and never the number.
ok('K1  the tail of the claim is its own element, so a narrow bar can drop it',
  /<span class="announce-tail">/.test(html), 'no .announce-tail element in index.html');
ok('K2  the shipping line goes at 860px, above the 833px the whole line needs',
  prop(BASE, '.announce-shipping', 'display') !== 'none'
  && prop(M860, '.announce-shipping', 'display') === 'none'
  && PX(prop(M860, '.announce', 'font-size')) < 11,
  'base=' + prop(BASE, '.announce-shipping', 'display')
  + ' 860=' + prop(M860, '.announce-shipping', 'display')
  + ' size=' + prop(M860, '.announce', 'font-size'));
ok('K3  a phone drops the tail of the claim rather than the number',
  prop(M600, '.announce-tail', 'display') === 'none' && prop(BASE, '.announce-tail', 'display') !== 'none',
  '600=' + prop(M600, '.announce-tail', 'display') + ' base=' + prop(BASE, '.announce-tail', 'display'));
ok('K4  and the line wraps as a last resort instead of leaving the screen',
  prop(BASE, '.announce-content', 'white-space') === 'nowrap'
  && prop(M600, '.announce-content', 'white-space') === 'normal'
  && prop(M600, '.announce-content', 'flex-wrap') === 'wrap',
  '600 ws=' + prop(M600, '.announce-content', 'white-space')
  + ' wrap=' + prop(M600, '.announce-content', 'flex-wrap'));
ok('K5  the number itself never breaks across two lines',
  prop(M600, '.announce-phone', 'white-space') === 'nowrap',
  prop(M600, '.announce-phone', 'white-space'));

// ---- L. banners, footer columns, and card framing ---------------------------
// The two category banners sat back-to-back with nothing between them, so two
// dark gradients read as one block; the footer grid defined four desktop tracks
// for three children, leaving a dead ~28% column; and the card photo sat on a
// beige panel around a white canvas inside a white card — a frame inside a
// frame. Each fix is pinned here so a later layout pass cannot quietly undo it.
ok('L1  the second category banner is separated from the first',
  prop(BASE, '.category-tile + .category-tile', 'margin-top') === '24px',
  prop(BASE, '.category-tile + .category-tile', 'margin-top'));
ok('L2  the footer grid has four tracks and a fourth, contact, column to fill them',
  prop(BASE, '.foot-grid', 'grid-template-columns') === '1.5fr 1fr 1fr 1.3fr'
    && /id="footCall"/.test(html) && /id="footText"/.test(html)
    && /<h2 class="foot-head">Contact<\/h2>/.test(html),
  prop(BASE, '.foot-grid', 'grid-template-columns'));
ok('L3  the footer contact links are filled from the runtime constant, not typed in',
  /\$\('footCall'\)/.test(app) && /footCall\.href = 'tel:' \+ ORDER_PHONE/.test(app)
    && /\$\('footText'\)/.test(app) && /footText\.href = 'sms:' \+ ORDER_PHONE/.test(app)
    && !/id="footCall" href="tel:/.test(html) && !/id="footText" href="sms:/.test(html),
  'footer links in app.js / index.html');
ok('L4  the card photo sits on the hero beige panel the owner wants',
  prop(BASE, '.product-image', 'background') === '#dfdeda'
    && prop(BASE, '.product-image', 'border-bottom') === '1px solid var(--line)',
  'background=' + prop(BASE, '.product-image', 'background'));
ok('L5  the listing gallery is top-aligned, so its rows stay a 12px gap apart',
  prop(BASE, '.gallery', 'align-self') === 'start',
  'align-self=' + prop(BASE, '.gallery', 'align-self'));
ok('L6  the steps banner matches the hero beige, like the card panels',
  prop(BASE, '.auth', 'background') === '#dfdeda',
  'background=' + prop(BASE, '.auth', 'background'));

const fails = results.filter((r) => !r.pass);
results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
process.exit(fails.length ? 1 : 0);