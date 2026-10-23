/* Type served from this domain: fonts/fonts.css and the woff2 files beside it
   Run: node test-fonts.js

   The head used to hand type to fonts.googleapis.com. It is local now, and nothing about
   the page reveals it if that breaks: a missing @font-face does not error, it silently
   falls back to Arial, and a mis-declared weight does not error either, it quietly renders
   every heading at one weight. Both failures look like a design decision. This suite pins:

     A. no page asks a font host for anything — not a stylesheet, not a preconnect;
     B. every url() in fonts.css is a woff2 that exists, and every woff2 in fonts/ is named
        by a face (an orphan is a file nobody can ever download);
     C. the faces cover the weights styles.css actually asks for — the one thing a variable
        font makes easy to get wrong, since a wrong range is not an error;
     D. the promises the faces make: font-display: swap, a unicode-range, and a total
        payload that stays in the tens of KB.

   Checked by hand once, and worth repeating: fonts/manrope.woff2 is a real variable font
   (fvar + gvar + STAT in its table directory), so `font-weight: 400 800` over one file is
   honest. Do not check that by searching the bytes for "fvar" — WOFF2 encodes known table
   tags as flag bytes, so the string never appears and the search always "fails". */

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(__dirname, f));
const size = (f) => fs.statSync(path.join(__dirname, f)).size;

const html = read('index.html');
const css = read('styles.css');
const FONTS = path.join(__dirname, 'fonts');
const faceCss = read('fonts/fonts.css');

// ---- the faces, as declared -------------------------------------------------
const faces = (faceCss.match(/@font-face\s*\{[\s\S]*?\}/g) || []).map((block) => ({
  family: (block.match(/font-family:\s*'([^']+)'/) || [])[1],
  style: (block.match(/font-style:\s*([\w]+)/) || [])[1],
  weight: (block.match(/font-weight:\s*([\d ]+)/) || [])[1],
  file: (block.match(/url\('([^']+)'\)/) || [])[1],
  display: (block.match(/font-display:\s*([\w]+)/) || [])[1],
  range: /unicode-range:/.test(block)
}));

ok('A1  fonts/fonts.css declares @font-face rules', faces.length >= 3, 'faces=' + faces.length);

// ---- A. nothing is fetched from a font host ---------------------------------
const pages = ['index.html'].concat(
  fs.readdirSync(path.join(__dirname, 'product')).filter((d) => exists('product/' + d + '/index.html'))
    .map((d) => 'product/' + d + '/index.html')
);
// Comments are scrubbed first: index.html explains where the vendored QR library came
// from, and a provenance note is not a request.
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const thirdParty = [];
pages.forEach((page) => {
  const body = stripComments(read(page));
  ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.bunny.net', 'use.typekit.net']
    .forEach((host) => { if (body.indexOf(host) >= 0) thirdParty.push(page + ' -> ' + host); });
});
ok('A2  no page, listing pages included, names a third-party font host',
  thirdParty.length === 0, thirdParty.slice(0, 3).join(', '));

ok('A3  index.html loads the local stylesheet, and it is stamped',
  /href="fonts\/fonts\.css\?v=[0-9a-f]{8}"/.test(html),
  (html.match(/href="[^"]*fonts[^"]*"/) || ['no fonts link'])[0]);


// ---- B. the files line up with the rules ------------------------------------
const missing = [];
const notWoff2 = [];
faces.forEach((f) => {
  if (!f.file || !exists('fonts/' + f.file)) { missing.push(String(f.family) + ' -> ' + f.file); return; }
  if (fs.readFileSync(path.join(FONTS, f.file)).slice(0, 4).toString('latin1') !== 'wOF2') {
    notWoff2.push(f.file);
  }
});
ok('B1  every url() in fonts.css is a file that exists', missing.length === 0, missing.join(', '));
ok('B2  every one of them is a real woff2 (wOF2 magic, not a renamed file)',
  notWoff2.length === 0, notWoff2.join(', '));

const onDisk = fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2'));
const named = faces.map((f) => f.file);
const orphans = onDisk.filter((f) => named.indexOf(f) < 0);
ok('B3  no woff2 sits in fonts/ that no face points at', orphans.length === 0, orphans.join(', '));

// ---- C. the declared weights cover what the stylesheet asks for -------------
const used = [];
(css.match(/font-weight:\s*(\d{3})/g) || []).forEach((m) => used.push(Number(m.replace(/\D/g, ''))));
// Shorthands count too: "font: 800 72px/1 'DM Mono'" is a weight request in disguise.
(css.match(/font:\s*(\d{3})\b/g) || []).forEach((m) => used.push(Number(m.replace(/\D/g, ''))));
const lo = Math.min.apply(null, used);
const hi = Math.max.apply(null, used);

const manrope = faces.filter((f) => f.family === 'Manrope');
ok('C1  Manrope is one face carrying a weight range, not five files of the same bytes',
  manrope.length === 1 && /\d+ \d+/.test(manrope[0].weight || ''),
  manrope.map((f) => f.weight + ' ' + f.file).join(' | ') || 'no Manrope face');

const range = ((manrope[0] && manrope[0].weight) || '0 0').split(' ').map(Number);
ok('C2  its range covers every weight styles.css asks for (' + lo + '-' + hi + ')',
  range[0] <= lo && range[1] >= hi, 'range=' + range.join('-') + ' used=' + lo + '-' + hi);

const declared = ['Manrope', 'DM Mono'].filter((name) => {
  const stack = new RegExp("'" + name + "'").test(css);
  return stack && faces.some((f) => f.family === name);
});
ok('C3  both families the CSS stacks name are declared (no silent fallback to Arial)',
  declared.length === 2, 'declared=' + declared.join(', '));

// ---- D. the promises the faces make -----------------------------------------
const noSwap = faces.filter((f) => f.display !== 'swap').map((f) => f.family + ' ' + f.file);
ok('D1  every face sets font-display: swap, so no text is invisible while it loads',
  noSwap.length === 0, noSwap.join(', '));

const noRange = faces.filter((f) => !f.range).map((f) => f.file);
ok('D2  every face carries a unicode-range, so a script the site never writes is never fetched',
  noRange.length === 0, noRange.join(', '));

const total = onDisk.reduce((n, f) => n + size('fonts/' + f), 0);
ok('D3  the whole type payload stays under 120 KB (' + Math.round(total / 1024) + ' KB)',
  total < 120 * 1024, Math.round(total / 1024) + ' KB');

results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name +
  (r.pass ? '' : '   [' + r.extra + ']')));
const failed = results.filter((r) => !r.pass).length;
console.log('\nTOTAL=' + results.length + ' FAIL=' + failed);
if (failed) process.exitCode = 1;
