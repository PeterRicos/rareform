// build-images.js — writes the responsive versions of the two big photo areas.
//
// Run: npm i sharp && node build-images.js     (idempotent — safe to run at any time)
//
// Why a build step: the hero and the two category tiles are the only photographs above
// the fold, and each was shipped as one 300–400 KB JPEG whatever the screen. A phone
// asked for the same 1376px file a 4K desktop did, and no format newer than JPEG was
// offered, so the first paint of the homepage carried ~1 MB of still images a phone
// could not use (the animated clip on top of that is a separate file).
//
// srcset + <picture> is only worth anything if the smaller files exist, so this writes
// them: three widths per photo in AVIF, WebP and JPEG. The JPEG is the fallback the
// <img> keeps for anything that understands neither, so the page still works with no
// support at all.
//
// The derivatives are committed — a deploy is a static host with no build step, so
// nothing here runs at deploy time. Re-run it when a source photo is replaced.
//
// Safe to delete: without it, the pages keep pointing at the files it already wrote.

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('build-images.js needs sharp: run "npm i sharp" first.');
  process.exit(1);
}

const ROOT = __dirname;

// Each source, the widths worth asking for, and the quality per format. Three widths is
// deliberate: the SRCSET in index.html offers exactly these, and a fourth would be a
// file nothing ever requests.
const JOBS = [
  {
    // Half the hero on desktop, full-bleed on a phone.
    src: 'images/hero.jpg',
    widths: [800, 1200, 1600],
    alt: 'Air Jordan 1 on the hero'
  },
  {
    src: 'images/clothing-crew.jpg',
    widths: [640, 960, 1376],
    alt: 'Clothing & accessories tile'
  },
  {
    src: 'images/randomshit-room.jpg',
    widths: [640, 960, 1376],
    alt: 'Random shit tile'
  }
];

// AVIF first: at these sizes it is roughly half the WebP and a third of the JPEG. The
// quality numbers are not the same scale — 50 AVIF is not 50 JPEG — so each format is
// tuned to the point where the photo stops visibly changing, not to one shared number.
const FORMATS = [
  { ext: 'avif', encode: (img) => img.avif({ quality: 50, effort: 4 }) },
  { ext: 'webp', encode: (img) => img.webp({ quality: 72, effort: 4 }) },
  { ext: 'jpg', encode: (img) => img.jpeg({ quality: 78, mozjpeg: true, progressive: true }) }
];

function baseName(src) {
  return path.join(path.dirname(src), path.basename(src, path.extname(src)));
}

const crypto = require('crypto');
const sha1Of = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

(async () => {
  const written = [];
  // What each derivative was made from. test-images.js compares these hashes against the
  // sources on disk, because a replaced photo is the one stale thing this pipeline could
  // hide: an out-of-date .avif looks perfectly fine, it just shows the old picture.
  const sources = {};
  for (const job of JOBS) {
    const file = path.join(ROOT, job.src);
    if (!fs.existsSync(file)) {
      console.error('missing source: ' + job.src);
      process.exitCode = 1;
      continue;
    }
    const meta = await sharp(file).metadata();
    const record = { sha1: sha1Of(file), widths: [] };
    sources[job.src] = record;
    for (const width of job.widths) {
      // Never upscale: a width larger than the source would only inflate a blur.
      if (width > meta.width) {
        console.log('skip  ' + job.src + ' @' + width + ' (source is ' + meta.width + 'px)');
        continue;
      }
      record.widths.push(width);
      for (const format of FORMATS) {
        const out = baseName(job.src) + '-' + width + '.' + format.ext;
        const buf = await format.encode(sharp(file).resize({ width: width, withoutEnlargement: true }))
          .toBuffer();
        fs.writeFileSync(path.join(ROOT, out), buf);
        written.push({ file: out, kb: Math.round(buf.length / 1024) });
      }
    }
  }

  // Grouped by photo so the saving is readable: the first width is what a phone gets.
  let total = 0;
  written.forEach((w) => { total += w.kb; });
  written.forEach((w) => console.log(String(w.kb).padStart(5) + ' KB  ' + w.file));

  // Sorted keys and no timestamp, so re-running on unchanged sources writes an identical
  // file and the commit stays clean.
  const manifest = { generatedBy: 'build-images.js', sources: {} };
  Object.keys(sources).sort().forEach((key) => { manifest.sources[key] = sources[key]; });
  fs.writeFileSync(path.join(ROOT, 'images/derivatives.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('written=' + written.length + ' total=' + Math.round(total / 1024) + ' MB' +
    ' manifest=images/derivatives.json');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
