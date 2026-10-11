// stamp-assets.js — keeps the CSS/JS references in index.html cache-busted.
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
// (Images and icons are left alone: they are replaced by adding a new file rather
// than by editing one in place.)
const ASSETS = ['styles.css', 'products.js', 'app.js'];
const PAGE = 'index.html';

const page = path.join(__dirname, PAGE);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The hash is taken over the file's text with CRLF folded to LF. The repo stores
// LF, but a Windows checkout writes CRLF, so hashing the raw bytes would give this
// folder one hash and the Linux workflow a different one for the same source —
// every local push would then be "corrected" by a workflow commit, and back again.
// Normalising makes both agree, and means a change that only flips line endings
// does not reshuffle the URLs. Only the fact that the hash changes matters, never
// its value.
const hash = (file) => crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex')
  .slice(0, 8);

const before = fs.readFileSync(page, 'utf8');
let after = before;
let refs = 0;

ASSETS.forEach((asset) => {
  const v = hash(asset);
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

if (after === before) {
  console.log(PAGE + ' rewritten=no refs=' + refs + ' (already current)');
} else {
  fs.writeFileSync(page, after);
  console.log(PAGE + ' rewritten=yes refs=' + refs);
}