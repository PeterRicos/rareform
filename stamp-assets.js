// stamp-assets.js — keeps the CSS/JS/hero-clip references in index.html cache-busted.
//
// Run: node stamp-assets.js     (idempotent — safe to run at any time)
//
// GitHub Pages serves this site with "Cache-Control: max-age=600", so for ten
// minutes after a deploy a browser — and the shared cache in front of Pages — is
// allowed to hand back the styles.css/products.js/app.js it fetched earlier.
// index.html asks for those files by bare name, so the URL never changes and
// nothing tells a cache the bytes did. Appending a short content hash
// ("app.js?v=1a2b3c4d") makes the URL change with the file: a new deploy is a new
// URL, so the stale copy sits behind a URL nobody requests any more and the change
// lands on the next load instead of whenever the ten minutes run out.
//
// .github/workflows/stamp-assets.yml runs this on every push to main and commits
// the result, so no listing edit (or bot commit) has to remember to.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Everything index.html pulls from this folder and that a deploy can change.
// (qrcode.js is vendored rather than written here, but a deploy replaces it just
// the same, so it is stamped like the rest.)
// (Images and icons are left alone: they are replaced by adding a new file rather
// than by editing one in place.)
const ASSETS = ['styles.css', 'slugs.js', 'products.js', 'jsonld.js', 'app.js', 'qrcode.js', 'boot.js'];

// The hero clip is the one asset the owner swaps by overwriting a file in place, which
// is the case a bare URL handles worst: the name never changes, so for the ten minutes
// Pages allows every cache in the path is entitled to hand back the old clip — and
// browsers keep video far longer than ten minutes. Stamping it too means a swap is
// complete the moment it is pushed, with no rename and no HTML edit.
// It is hashed as bytes rather than text: it has no line endings to normalise, and
// reading a video as UTF-8 (which the text path does) is how a clip gets destroyed.
// It may also legitimately be absent — with no file the hero is the still image — so a
// missing clip is skipped rather than treated as an error.
const HERO_CLIP = 'video/reel.mp4';
const MEDIA = [HERO_CLIP];
const PAGE = 'index.html';

// The same fact — whether the clip is really here — also switches the <video> tag in
// index.html on and off, so the page can never request a file that is not there. That
// request is what put a 404 in the console on every visit before the tag was commented
// out, and it is why the tag was not simply left live: an empty player that quietly
// fails is worse than no player at all. Dropping the clip in (and pushing) is the whole
// install; this is what turns it on. Hand-editing between the markers is pointless,
// exactly as it is for the catalog JSON-LD block.
const HERO_TAG = [
  '        <video class="hero-video" id="heroVideo" autoplay muted loop playsinline preload="metadata" aria-hidden="true" tabindex="-1">',
  '          <source src="' + HERO_CLIP + '" type="video/mp4">',
  '        </video>'
].join('\n');

// The switched-off body keeps the tag visible-but-inert, so uncommenting by hand is
// never necessary — and never possible to leave half-done.
const HERO_BLOCK = (on) => (on ? HERO_TAG : [
  '        <!-- No clip in this checkout, so the tag stays off rather than requesting a',
  '             file that is not there: the still image above it is the whole hero.',
  HERO_TAG,
  '        -->'
].join('\n'));

const HERO_REGION = /(<!-- hero-video:begin[^>]*-->)([\s\S]*?)(<!-- hero-video:end -->)/;
// The markers sit inside <div class="hero-image"> in index.html, one level in, so the
// regenerated body is indented to match its neighbours there.
const HERO_INDENT = ' '.repeat(8);

const page = path.join(__dirname, PAGE);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The hash is taken over the file's text with CRLF folded to LF. The repo stores
// LF, but a Windows checkout writes CRLF, so hashing the raw bytes would give this
// folder one hash and the Linux workflow a different one for the same source —
// every local push would then be "corrected" by a workflow commit, and back again.
// Normalising makes both agree, and means a change that only flips line endings
// does not reshuffle the URLs. Only the fact that the hash changes matters, never
// its value.
const hashText = (file) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex')
  .slice(0, 8);

// Raw bytes, no normalising: two clips differ or they do not.
const hashBytes = (file) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, file)))
  .digest('hex')
  .slice(0, 8);

const before = fs.readFileSync(page, 'utf8');
let after = before;
let refs = 0;

// Switch the hero tag on only when the clip is present. Runs before the stamping below
// so the src it writes is the one that gets the ?v=, not a stale copy of it.
const heroRegion = HERO_REGION.exec(after);
if (!heroRegion) {
  console.log('hero video: no <!-- hero-video:begin --> / end markers in ' + PAGE + ' - skipped');
} else {
  const on = fs.existsSync(path.join(__dirname, HERO_CLIP));
  after = after.replace(HERO_REGION, (whole, begin, body, end) =>
    begin + '\n' + HERO_BLOCK(on) + '\n' + HERO_INDENT + end);
  console.log(HERO_CLIP + (on ? ' present' : ' absent') + ' -> hero tag ' + (on ? 'on' : 'off'));
}

const stamp = (assets, hashOf) => assets.forEach((asset) => {
  const full = path.join(__dirname, asset);
  if (!fs.existsSync(full)) {
    console.log(asset + ' MISSING - left alone (nothing requests it in that state)');
    return;
  }
  const v = hashOf(asset);
  // Only attribute values are rewritten ("href=styles.css" / "src=app.js"), and an
  // existing ?v=... is replaced rather than stacked, so re-running changes nothing.
  const re = new RegExp('(href|src)="' + escape(asset) + '(?:\\?v=[0-9a-f]+)?"', 'g');
  let hits = 0;
  after = after.replace(re, (whole, attr) => {
    hits += 1;
    return attr + '="' + asset + '?v=' + v + '"';
  });
  refs += hits;
  console.log(asset + ' -> ?v=' + v + ' refs=' + hits +
    (hits ? '' : '   WARNING: ' + PAGE + ' does not reference this file'));
});

stamp(ASSETS, hashText);
stamp(MEDIA, hashBytes);

if (after === before) {
  console.log(PAGE + ' rewritten=no refs=' + refs + ' (already current)');
} else {
  fs.writeFileSync(page, after);
  console.log(PAGE + ' rewritten=yes refs=' + refs);
}