/* Static brand-tile harness for index.html + styles.css + app.js (same folder)
   Run: node test-brand-tiles.js    (or: node rareform/test-brand-tiles.js)

   The homepage's brand grid is the shop's roadmap: the six brands it wants to be known
   for, plus "All Brands", plus every other brand the catalog actually carries. Two
   things about it had gone stale. The tiles were a grey rectangle with the brand typed
   into it — the one place on an otherwise carefully set page that read as a
   placeholder — and the grid was pinned to eight columns, which is not a count that
   tile list divides into, so the last row left a gap.

   What has to stay true, none of which either a phone or a desktop pass would catch:

     - the grid takes its columns from the room it has, with a 150px floor, and no
       breakpoint goes back to naming a count
     - every mark is set, not fetched. The tiles ask nobody for a logo file, so there is
       nothing to license, nothing to 404 and nothing to go stale in a CDN
     - a name is set the way its brand sets it — adidas and new balance lowercase,
       "Supreme" in title case — in the DOM and not only in pixels, so a screen reader
       and a copy-paste get the brand's own spelling
     - the two marks that are shapes are drawn in the sheet (adidas's three bars,
       Supreme's box) rather than lifted
     - a brand the table has never heard of still gets a deliberate treatment instead of
       the old placeholder, and no mark a tile can be given is left unstyled
     - and none of it costs what the tiles already did: focusable buttons with a focus
       ring, the lime "this filter is on" fill, and the reserved dashed look for a brand
       with no stock yet

   Everything here is read out of the shipped files, so it runs anywhere Node runs. */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');

// Rules are read out of a comment-free copy: a /* ... */ block between two rules would
// otherwise be glued onto the next selector and that rule would look missing. The raw
// text is still what the "does this string appear" checks use.
const CSS = css.replace(/\/\*[\s\S]*?\*\//g, '');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });

// ---- tiny CSS readers, the same shape test-mobile.js reads the sheet with ----
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
// source order — several rules legitimately mention the same selector, and reading only
// the first would call a rule missing when the browser is in fact applying the later one.
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
const M820 = media('max-width: 820px');
const M1024 = media('max-width: 1024px');

const PX = (v) => { const m = String(v || '').match(/^([\d.]+)px$/); return m ? Number(m[1]) : NaN; };
const EM = (v) => { const m = String(v || '').match(/^(-?[\d.]+)em$/); return m ? Number(m[1]) : NaN; };
const find = (re, src) => { const m = String(src || '').match(re); return m ? m[0] : null; };
const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);

// The rule the sheet uses to paint a mark, and the values inside it.
const markSel = (mark) => '.brand-tile[data-mark="' + mark + '"] .wm';
const scaleOf = (mark) => Number(prop(BASE, markSel(mark), '--wm-scale'));
const skewOf = (mark) => prop(BASE, markSel(mark), '--wm-skew');
const trackOf = (mark) => prop(BASE, markSel(mark), '--wm-track');
const caseOf = (mark) => prop(BASE, markSel(mark), '--wm-case');

// The markup the grid is built from, cut out of app.js.
const grid = find(/\$\('brandGrid'\)\.innerHTML\s*=[\s\S]*?\.join\(''\);/, app) || '';

// Every mark a tile can be given: the ones named in BRAND_MARKS, the plain fallback,
// and the "All Brands" tile's, which is written straight into the markup.
const marksUsed = uniq(
  [...app.matchAll(/mark:\s*'([a-z]+)'/g)].map((m) => m[1])
  .concat([...app.matchAll(/data-mark="([a-z]+)"/g)].map((m) => m[1]))
);
const marksStyled = uniq([...CSS.matchAll(/\[data-mark="([a-z]+)"\]/g)].map((m) => m[1]));

// ---- A. the grid sizes its own columns ----------------------------------------
ok('A1  the grid takes its columns from the room it has, with a 150px floor',
  prop(BASE, '.brand-grid', 'grid-template-columns') === 'repeat(auto-fit, minmax(150px, 1fr))',
  prop(BASE, '.brand-grid', 'grid-template-columns'));
ok('A2  and no breakpoint names a column count again',
  prop(M1024, '.brand-grid', 'grid-template-columns') === null
  && prop(M820, '.brand-grid', 'grid-template-columns') === null,
  '1024=' + prop(M1024, '.brand-grid', 'grid-template-columns')
  + ' 820=' + prop(M820, '.brand-grid', 'grid-template-columns'));
ok('A3  the eight-column ladder this replaced is gone',
  !/grid-template-columns:\s*repeat\(8,\s*1fr\)/.test(CSS));
ok('A4  the tiles are still spaced and still rounded like the rest of the page',
  PX(prop(BASE, '.brand-grid', 'gap')) === 10 && prop(BASE, '.brand-tile', 'border-radius') === 'var(--radius)');

// ---- B. the marks are set, not fetched ----------------------------------------
ok('B1  the grid asks nobody for a logo file',
  grid.length > 0 && !/<img|<svg|background-image|url\(|\.png|\.jpg|\.jpeg|\.svg|\.webp/i.test(grid),
  find(/<img[^>]*>|<svg|url\([^)]*\)/, grid) || 'no grid markup found');
ok('B2  and it reaches for no third-party host at all',
  !/https?:\/\//.test(grid));
ok('B3  every tile is a button carrying the mark that styles it',
  /class="brand-tile" data-mark="all"/.test(grid) && /class="brand-tile\$\{has \? '' : ' soon'\}" data-mark="\$\{m\.mark\}"/.test(grid),
  find(/class="brand-tile[^"]*"[^>]{0,40}/, grid));
ok('B4  a tile still passes an index, so a brand with an apostrophe cannot break out',
  /onclick="filterByBrandAt\(\$\{i\}, this\)"/.test(grid));
ok('B5  a name that comes from the catalog is escaped on the way into the markup',
  /wm:\s*esc\(plain\)/.test(app));
ok('B6  the grid is still the roadmap plus the catalog, not a hardcoded six',
  /BRAND_TILES\.slice\(\)/.test(app) && /tiles\.push\(b\)/.test(app));
ok('B7  and index.html still ships the container app.js renders all of it into',
  /<div class="brand-grid" id="brandGrid"><\/div>/.test(html),
  find(/<div class="brand-grid"[^>]*>/, html) || 'no #brandGrid in index.html');

// ---- C. one mark per brand, written the way the brand writes it ----------------
const ROADMAP = ['jordan', 'nike', 'adidas', 'new balance', 'travis scott', 'supreme'];
const marks = app.match(/const BRAND_MARKS = \{[\s\S]*?\n    \};/) || [''];
const entry = (brand) => {
  const m = marks[0].match(new RegExp("'" + brand + "':\\s*\\{([^}]*)\\}"));
  return m ? m[1] : null;
};
ok('C1  every brand on the roadmap has a mark of its own',
  ROADMAP.every((b) => entry(b) !== null),
  ROADMAP.filter((b) => entry(b) === null).join(', ') || 'none');
ok('C2  the marks are keyed by brand, so the catalog\'s "Supreme" finds the list\'s "SUPREME"',
  /BRAND_MARKS\[plain\.toLowerCase\(\)\]/.test(app));
ok('C3  adidas and new balance are lowercase in the DOM, not only in pixels',
  /wm:\s*'adidas'/.test(entry('adidas') || '') && /wm:\s*'new balance'/.test(entry('new balance') || ''));
ok('C4  and Supreme keeps the capital its brand uses',
  /wm:\s*'Supreme'/.test(entry('supreme') || ''));
ok('C5  Travis Scott is stacked, not run together on one line',
  /wm:\s*'TRAVIS<br>SCOTT'/.test(entry('travis scott') || ''));
ok('C6  every mark names the rule that shapes it',
  ROADMAP.every((b) => /mark:\s*'[a-z]+'/.test(entry(b) || '')),
  ROADMAP.map((b) => b + '=' + find(/mark:\s*'([a-z]+)'/, entry(b) || '')).join(' '));
ok('C7  every mark a tile can be given has a rule that sets it',
  marksUsed.filter((m) => m !== 'plain').every((m) => hasRule(BASE, markSel(m)) || hasRule(BASE, '.brand-tile[data-mark="' + m + '"]')),
  marksUsed.filter((m) => m !== 'plain' && !hasRule(BASE, markSel(m)) && !hasRule(BASE, '.brand-tile[data-mark="' + m + '"]')).join(', ') || 'all styled');
ok('C8  and no mark rule is dead',
  marksStyled.every((m) => marksUsed.indexOf(m) >= 0),
  marksStyled.filter((m) => marksUsed.indexOf(m) < 0).join(', ') || 'none');
ok('C9  a brand the table has never heard of still gets a deliberate treatment',
  /mark:\s*'plain'/.test(app) && /plain\.length > 13 \? 'long'/.test(app)
  && Number(prop(BASE, '.brand-tile[data-len="long"] .wm', '--wm-scale')) < Number(prop(BASE, '.brand-tile[data-len="med"] .wm', '--wm-scale')),
  'long=' + prop(BASE, '.brand-tile[data-len="long"] .wm', '--wm-scale')
  + ' med=' + prop(BASE, '.brand-tile[data-len="med"] .wm', '--wm-scale'));

// ---- D. brand-appropriate letterforms ------------------------------------------
const STYLED = ['condensed', 'oblique', 'bars', 'lower', 'wide', 'box'];
ok('D1  every mark says how it is set: a size, and a width/slant or a spacing',
  STYLED.every((mk) => scaleOf(mk) > 0 && (find(/skewX\(-?[\d.]+deg\)/, skewOf(mk)) || EM(trackOf(mk)))),
  STYLED.map((mk) => mk + '=' + scaleOf(mk) + '/' + skewOf(mk)).join(' '));
ok('D2  Nike is the largest name on the wall',
  STYLED.every((mk) => mk === 'oblique' || scaleOf('oblique') > scaleOf(mk)),
  STYLED.map((mk) => mk + '=' + scaleOf(mk)).join(' '));
ok('D3  Jordan and Nike are condensed, never stretched',
  /scaleX\(0\.\d+\)/.test(skewOf('condensed') || '') && /scaleX\(0\.\d+\)/.test(skewOf('oblique') || ''),
  skewOf('condensed') + ' | ' + skewOf('oblique'));
ok('D4  and every slanted mark leans the same way',
  ['condensed', 'oblique', 'lower', 'box'].every((mk) => /skewX\(-\d/.test(skewOf(mk) || '')),
  ['condensed', 'oblique', 'lower', 'box'].map((mk) => mk + '=' + skewOf(mk)).join(' | '));
ok('D5  Travis Scott is the one mark set wide, spelled out in caps',
  EM(trackOf('wide')) > 0.1 && caseOf('wide') === null,
  'track=' + trackOf('wide') + ' case=' + caseOf('wide'));
ok('D6  adidas is closed up tighter than the default, and New Balance keeps the tag\'s lowercase',
  EM(trackOf('bars')) < -0.03 && caseOf('bars') === 'none' && caseOf('lower') === 'none',
  'bars track=' + trackOf('bars') + ' case=' + caseOf('bars') + ' lower case=' + caseOf('lower'));
ok('D7  Supreme is white on the box red — but only while it is actually stocked',
  prop(BASE, '.brand-tile[data-mark="box"]:not(.soon)', 'background') === '#ce1126'
  && prop(BASE, '.brand-tile[data-mark="box"]:not(.soon) .wm', 'color') === '#fff',
  prop(BASE, '.brand-tile[data-mark="box"]:not(.soon)', 'background') + ' / '
  + prop(BASE, '.brand-tile[data-mark="box"]:not(.soon) .wm', 'color'));
ok('D8  the three bars are drawn in the sheet, not fetched',
  /\.brand-tile\[data-mark="bars"\] \.wm::after\s*\{[^}]*repeating-linear-gradient/.test(CSS)
  && /clip-path:\s*polygon\(/.test(CSS)
  && /transform:\s*skewX\(-14deg\)/.test(CSS));
ok('D9  "All Brands" is set as the label it is, not as a brand',
  prop(BASE, '.brand-tile[data-mark="all"] .wm', 'font-family') === "'DM Mono', monospace"
  && EM(prop(BASE, '.brand-tile[data-mark="all"] .wm', 'letter-spacing')) > 0.1,
  prop(BASE, '.brand-tile[data-mark="all"] .wm', 'font-family') + ' '
  + prop(BASE, '.brand-tile[data-mark="all"] .wm', 'letter-spacing'));
ok('D10 the wordmark is centred in its tile and takes the tile\'s colour',
  prop(BASE, '.brand-tile', 'place-items') === 'center'
  && !prop(BASE, '.brand-tile .wm', 'color'));

// ---- E. what the marks must not break ------------------------------------------
ok('E1  a tile is still a focusable button, with a focus ring to match',
  /<button type="button" class="brand-tile/.test(grid) && hasRule(BASE, '.brand-tile:focus-visible'));
ok('E2  the lime fill still means "this filter is on"',
  prop(BASE, '.brand-tile:hover', 'background') === 'var(--lime)'
  && prop(BASE, '.brand-tile.selected', 'background') === 'var(--lime)');
ok('E3  and the box tile keeps its red when picked, showing the lime as its border',
  /\.brand-tile\[data-mark="box"\]:not\(\.soon\)\.selected\s*\{[^}]*background:\s*#ce1126[^}]*border-color:\s*var\(--lime\)/.test(CSS));
ok('E4  a brand with no stock still reads as dashed and dimmed',
  hasRule(BASE, '.brand-tile.soon') && prop(BASE, '.brand-tile.soon', 'color') === 'var(--muted)'
  && prop(BASE, '.brand-tile.soon', 'border-style') === 'dashed',
  prop(BASE, '.brand-tile.soon', 'border-style') + ' ' + prop(BASE, '.brand-tile.soon', 'color'));
ok('E5  and it keeps the "Soon" tag that explains it',
  /<span class="tag">Soon<\/span>/.test(grid)
  && /aria-label="\$\{esc\(b\)\} — no pairs in stock yet"/.test(grid));
ok('E6  a tile is still a thumb-sized target, on a desktop and on a phone',
  PX(prop(BASE, '.brand-tile', 'height')) >= 44 && PX(prop(M820, '.brand-tile', 'height')) >= 44,
  prop(BASE, '.brand-tile', 'height') + ' / ' + prop(M820, '.brand-tile', 'height'));

// ---- F. the hero's tiles route to the shop they name ----------------------------
// The first hero tile used to be a bare go('shop'), which keeps whatever category
// the last visit left on the shop: browse Random Shit, come home, click BROWSE
// SNEAKERS, and the shop still said RANDOM SHIT with its four items. A tile that
// names a category has to route through shopCategory(), which clears the filters
// first — and the shop header needs a title for the sneakers run it then shows,
// or the tile filters to sneakers while the page still reads SHOP ALL.
const heroTiles = find(/<div class="btn-row hero-tiles">[\s\S]*?<\/div>/, html) || '';
ok('F1  BROWSE SNEAKERS routes through shopCategory, not a bare go()',
  /onclick="shopCategory\('sneakers'\)">BROWSE SNEAKERS/.test(heroTiles),
  heroTiles);
ok('F2  no hero tile navigates without clearing the category first',
  !/onclick="go\('/.test(heroTiles),
  heroTiles);
ok('F3  the shop header names the sneakers run the tile lands on',
  /CATEGORY_TITLES\s*=\s*\{[^}]*sneakers:\s*'SNEAKERS'/.test(app),
  find(/const CATEGORY_TITLES[^;]+;/, app) || 'no CATEGORY_TITLES');

// ---- F4-F6. this page is a vault, not a cart -------------------------------------
// Friends and family went looking for an Add to Cart button and a price tag, found
// neither, and read the page as sold out or unfinished. There is no cart by design, so
// the page has to say what replaces it -- and it must never quietly grow one instead.
// The phrase itself is gone, not merely unlinked: "add to cart" in a comment or an
// aria-label is still a promise a scraper, a search engine or a screen reader can read.
ok('F4  nothing in the page even names a cart, a checkout or a buy-now path',
  !/add[\s-]*to[\s-]*cart|>\s*(checkout|buy now)/i.test(html)
    && !/add[\s-]*to[\s-]*cart|>\s*(checkout|buy now)/i.test(app),
  ((html + app).match(/[^>\n]{0,40}add[\s-]*to[\s-]*cart[^<\n]{0,40}/gi) || []).join(' | '));
ok('F5  the page says a pair is claimed by message, and the price comes on asking',
  /no cart,? no checkout/i.test(html) && /claim a pair by call, text or whatsapp/i.test(html)
    && /we will confirm the price/.test(app),
  'no-cart: ' + /no cart,? no checkout/i.test(html)
    + '  claim: ' + /claim a pair by call, text or whatsapp/i.test(html)
    + '  price: ' + /we will confirm the price/.test(app));
ok('F6  the unfiltered shop is named the vault in both the markup and the render path',
  /<h1 id="shopTitle">THE VAULT<\/h1>/.test(html) && /\|\| 'THE VAULT'/.test(app),
  find(/\|\|[^;]*THE VAULT[^;]*/, app) || 'no vault fallback title');


const fails = results.filter((r) => !r.pass);
results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
process.exit(fails.length ? 1 : 0);