/* Responsive photos: the two category tiles (same folder)
   Run: node test-images.js

   The hero photo was removed 2026-10-30 at the owner's ask (it showed while the
   hero clip was still loading), so only the two category tiles remain here.
   index.html offers each of those two photos in three widths and three formats, so a
   phone stops downloading the 400 KB JPEG a desktop gets. That only works while the
   files it names all exist — a srcset is a list of URLs nobody validates at runtime, and
   a missing one is not a broken layout, it is a blank panel or a silent fallback to the
   biggest file. This suite pins:

     A. every URL in every srcset is on disk, at all three widths;
     B. all three formats were generated for each width (an AVIF-only width would send a
        browser without AVIF support back to the full-size JPEG);
     C. the derivatives are smaller than the source, and the AVIF is materially smaller
        than the JPEG — the reason for the exercise;
     D. the derivatives were made from the photos that are here now, which is the one
        staleness nothing on the page would reveal (an out-of-date .avif looks fine).

   build-images.js writes the manifest this checks; run it after replacing a source. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(__dirname, f));
const size = (f) => fs.statSync(path.join(__dirname, f)).size;
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, f))).digest('hex');

const html = read('index.html');
const MANIFEST = 'images/derivatives.json';
const manifest = exists(MANIFEST) ? JSON.parse(read(MANIFEST)) : null;
const sources = (manifest && manifest.sources) || {};

ok('A1  images/derivatives.json records what the derivatives were made from',
  Object.keys(sources).length === 3, Object.keys(sources).join(', ') || 'missing');

// ---- D. the derivatives match the photos that are here now -------------------
const stale = [];
Object.keys(sources).forEach((src) => {
  if (!exists(src)) { stale.push(src + ' (source gone)'); return; }
  if (sha1(src) !== sources[src].sha1) stale.push(src + ' (changed)');
});
ok('D1  no derivative was made from a photo that has since been replaced',
  stale.length === 0,
  stale.join(', ') + (stale.length ? ' — run "node build-images.js"' : ''));

// ---- A/B. every URL the page names exists, in every format -------------------
const pictures = html.match(/<picture>[\s\S]*?<\/picture>/g) || [];
ok('A2  both category tiles are <picture> blocks (the hero still was removed 2026-10-30)', pictures.length === 2,
  'pictures=' + pictures.length);

const missing = [];
const uneven = [];
const negative = [];
pictures.forEach((block, i) => {
  const sets = [];
  (block.match(/srcset="([^"]*)"/g) || []).forEach((attr) => {
    const urls = attr.replace(/^srcset="/, '').replace(/"$/, '').split(',')
      .map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
    sets.push(urls);
    urls.forEach((url) => { if (!exists(url)) missing.push('picture ' + i + ': ' + url); });
  });
  const src = (block.match(/<img[^>]*\ssrc="([^"]+)"/) || [])[1];
  if (!src || !exists(src)) missing.push('picture ' + i + ' img src=' + src);

  // Same number of widths in each format, or a browser that falls back to the next
  // <source> lands on a size that was never generated for it.
  const widths = sets.map((urls) => urls.length);
  if (new Set(widths).size !== 1) uneven.push('picture ' + i + ' widths=' + widths.join('/'));

  // The JPEG <img> is the last resort, and it is also the box that reserves the space.
  if (!/\.jpg$/.test(src || '')) negative.push('picture ' + i + ' fallback=' + src);
  if (!/\ssizes="/.test(block)) negative.push('picture ' + i + ' has no sizes');
  if (!/<img[^>]*\swidth="\d+"/.test(block) || !/<img[^>]*\sheight="\d+"/.test(block)) {
    negative.push('picture ' + i + ' has no intrinsic size');
  }
});

ok('A3  every srcset URL, and every fallback src, is a file that exists',
  missing.length === 0, missing.slice(0, 3).join(', '));
ok('A4  each width is offered in all three formats', uneven.length === 0, uneven.join(', '));
ok('A5  the fallback is a JPEG and the block declares sizes and an intrinsic size',
  negative.length === 0, negative.slice(0, 3).join(', '));

// ---- C. the derivatives earn their place ------------------------------------
const heavy = [];
const weak = [];
Object.keys(sources).forEach((src) => {
  const base = src.replace(/\.jpg$/, '');
  sources[src].widths.forEach((width) => {
    const avif = base + '-' + width + '.avif';
    const webp = base + '-' + width + '.webp';
    const jpg = base + '-' + width + '.jpg';
    [avif, webp, jpg].forEach((f) => { if (!exists(f)) heavy.push(f + ' (missing)'); });
    if (!exists(avif) || !exists(jpg)) return;
    if (size(avif) >= size(jpg)) heavy.push(avif + ' is not smaller than its JPEG');
    // At these widths AVIF came out near a third of the JPEG. A photo that lands above
    // half means a broken encode rather than a hard photo.
    if (size(avif) > size(jpg) * 0.6) {
      weak.push(avif + ' ' + Math.round(size(avif) / size(jpg) * 100) + '% of jpg');
    }
  });
  // The phone is the case this exists for: its width has to beat the original file.
  const smallest = Math.min.apply(null, sources[src].widths);
  const phone = base + '-' + smallest + '.avif';
  if (exists(phone) && size(phone) >= size(src)) heavy.push(phone + ' is not smaller than ' + src);
});
ok('C1  every derivative is smaller than the JPEG it replaces', heavy.length === 0,
  heavy.slice(0, 3).join(', '));
ok('C2  the AVIF is materially smaller than the same width in JPEG', weak.length === 0,
  weak.slice(0, 3).join(', '));

results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name +
  (r.pass ? '' : '   [' + r.extra + ']')));
const failed = results.filter((r) => !r.pass).length;
console.log('\nTOTAL=' + results.length + ' FAIL=' + failed);
if (failed) process.exitCode = 1;

