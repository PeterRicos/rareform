/* Hero video slot harness (index.html + video/reel.mp4)
   Run: node test-hero-video.js            (or: node rareform/test-hero-video.js)

   The hero clip is the only asset here that is not hand-written: it is a binary file
   the owner replaces by overwriting it in place, and the page is only allowed to
   request it while the file is really there. That leaves three ways to break the hero
   that nothing else in this repo would notice:

     1. the tag is live while the file is missing - a failed request and a 404 in the
        console on every single visit, which is why the tag is not simply left on;
     2. the file is in place while the tag is switched off - the hero silently stays a
        still image, and nothing looks broken;
     3. the file is present but is not really a video. An .mp4 that has been through a
        text pipeline keeps a valid-looking header while every byte the pipeline could
        not decode is replaced with U+FFFD, so the browser answers
        DEMUXER_ERROR_COULD_NOT_OPEN and the hero quietly falls back to the still.
        A screenshot cannot tell that apart from "no clip installed", so this harness
        reads the container itself instead of trusting the file extension.

     4. a word in the headline loses its ink. "LOOKING" was once an outline here - a
        transparent fill with a stroke as the whole of its ink - so one declaration carried
        the difference between that word and a hole in the hero, and a stroke drawn in
        currentColor (that same transparent fill) is how it went. The outline is retired in
        favour of solid ink; the checks below hold the fill painted and the outline gone, and
        nothing else in the repo reads the hero copy.

   It also checks the markup/CSS/JS contract the slot is built on, and that the ?v= on
   the clip in index.html really is the hash of the bytes on disk - the stamp is what
   keeps a swapped clip from being served out of a cache under its old name.        */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIP = 'video/reel.mp4';
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const page = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const stamp = read('stamp-assets.js');

// Rules are read out of a comment-free copy (the shape test-brand-tiles.js reads the sheet
// with): the retired outline below is explained by a comment that names currentColor and
// -webkit-text-stroke, and a comment paints nothing - reading rules out of the raw text would
// fail them for their own explanation. The raw text is still what "does this string appear"
// checks use.
const CSS = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Optional argument: a different clip path, so a candidate file can be inspected
// before it is installed (node test-hero-video.js "C:\path\to\new-clip.mp4").
const clipFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, CLIP);

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });
const skip = (name, why) => results.push({ name, skipped: true, why });
const notes = [];

// "Is the tag live?" is decided the way a browser decides it: comments are not markup,
// and the switched-off copy of the tag lives inside a comment. So strip them first.
const live = page.replace(/<!--[\s\S]*?-->/g, '');
const tagLive = /id="heroVideo"/.test(live);
const tagBlock = /<video[^>]*id="heroVideo"[^>]*>([\s\S]*?)<\/video>/.exec(page);
// Whether the tag may be live, and whether the stamp is right, are questions about the
// file in the repo: index.html can only ever request CLIP. So those two use the installed
// path, and the candidate argument only feeds the container checks further down.
const clipThere = fs.existsSync(clipFile);
const installed = fs.existsSync(path.join(__dirname, CLIP));

// ---------------------------------------------------------------- the pairing
const fix = !installed && tagLive
  ? 'the tag is live with no ' + CLIP + ': every visit would request it and log a 404 - run "node stamp-assets.js", or commit the clip'
  : installed && !tagLive
    ? CLIP + ' is in the repo while the hero tag is switched off: nobody would ever see it - run "node stamp-assets.js" and commit the result'
    : 'the tag and the file disagree';
ok('V1 hero clip ' + (installed ? 'present' : 'absent') + ' / tag ' +
   (tagLive ? 'live' : 'switched off') + ' (they must agree)', installed === tagLive, fix);

ok('V2 the tag exists between the hero-video markers', !!tagBlock, 'no <video id="heroVideo"> anywhere in index.html');
ok('V3 the begin/end markers each appear once',
  (page.match(/<!-- hero-video:begin/g) || []).length === 1 &&
  (page.match(/<!-- hero-video:end -->/g) || []).length === 1,
  'markers=' + (page.match(/<!-- hero-video:begin/g) || []).length + '/' +
               (page.match(/<!-- hero-video:end -->/g) || []).length);

// ------------------------------------------------------- markup contract
if (tagBlock) {
  const tag = tagBlock[0];
  const src = /<source\s+src="([^"]+)"\s+type="video\/mp4">/.exec(tag);
  const attrs = ['autoplay', 'muted', 'loop', 'playsinline'];
  attrs.forEach((a) => ok('V4 tag is ' + a, new RegExp('(^|\\s)' + a + '(\\s|>)', 'i').test(tag),
    a + ' missing: the browser would refuse to autoplay, or play sound, or stop after one pass'));
  ok('V4 tag preloads metadata only', /preload="metadata"/.test(tag),
    'without preload="metadata" the browser picks its own - commonly the whole file');
  ok('V4 tag is decorative to assistive tech', /aria-hidden="true"/.test(tag) && /tabindex="-1"/.test(tag),
    'the clip repeats what the still image and the copy already say, so it must stay out of the tab order and the a11y tree');
  ok('V4 tag is class="hero-video"', /class="hero-video"/.test(tag), 'styles.css only positions .hero-video (absolute inset 0, faded in by .is-ready)');
  ok('V4 source points at ' + CLIP, !!src && src[1].replace(/\?v=[0-9a-f]+$/, '') === CLIP,
    src ? src[1] + ' (the stamp and this harness both look for exactly ' + CLIP + ')' : 'no <source src=... type="video/mp4"> inside the tag');
  ok('V4 no second source: nothing asks for a file that is not shipped',
    (tag.match(/<source/g) || []).length === 1,
    'each extra <source> is another request that 404s before the browser gives up');
} else {
  skip('V4 tag contract', 'no tag in index.html');
}

// ------------------------------------------------------- CSS + JS contract
ok('V5 styles.css still positions .hero-video', /\.hero-video\s*\{[\s\S]*?position:\s*absolute/.test(css), 'the clip is the layer above the still image');
ok('V5 styles.css fades it in only when ready', /\.hero-video\.is-ready\s*\{\s*opacity:\s*1/.test(css), 'without this the clip decodes behind an opacity:0 and is never seen');
ok('V5 styles.css hides it for reduced motion', /prefers-reduced-motion:\s*reduce\s*\)\s*\{\s*\.hero-video\s*\{\s*display:\s*none/.test(css), 'a looping clip is exactly what prefers-reduced-motion is asked to stop');
ok('V5 app.js still wires the readiness class',
  /\$\('heroVideo'\)/.test(app) && /classList\.add\('is-ready'\)/.test(app) && /classList\.remove\('is-ready'\)/.test(app),
  "initHeroVideo() must look up $('heroVideo'), add is-ready on decode and remove it on error");
ok('V5 app.js still falls back when the clip fails', /addEventListener\('error',\s*hide\)/.test(app), 'a clip that stops decoding must return to the still image');

// ------------------------------------------------------- the headline is all one ink
// "LOOKING" in the headline was an outline once: its fill was transparent and a stroke was the
// whole of its ink, so a single declaration decided whether the word was there or a hole in the
// hero - and a stroke whose colour comes from the rule's own fill paints the word in that fill,
// which is how it went missing with both the markup and the rule still in place. It is plain
// text now, in the h1's own font and black, and these two checks hold the two ways that fails:
// the word leaving the markup, and a rule painting the headline's text in nothing. Nothing else
// in the repo reads the hero copy.
const heroRules = CSS.match(/\.hero h1[^{}]*\{[^}]*\}/g) || [];
ok('W1 the headline still carries its fourth word',
  /<h1>[\s\S]*?LOOKING[\s\S]*?<\/h1>/.test(page),
  'index.html has no hero <h1> containing LOOKING: the word is gone from the markup, where no CSS can draw it back');
ok('W2 no .hero h1 rule paints text transparent',
  heroRules.length > 0 && !heroRules.some((r) => /color:\s*transparent/.test(r)),
  'a transparent fill with nothing opaque painted over it is an invisible word: the headline is solid ink, so no .hero h1 rule may set color: transparent (see the comment where the .outline rule was)');
ok('W3 nothing strokes the headline',
  heroRules.length > 0 && !heroRules.some((r) => /text-stroke/.test(r)),
  'the outlined word was retired for solid ink - a text-stroke on the headline is how the word became a hole once, its stroke drawn in that same rule\'s transparent fill');

// ------------------------------------------------------- stamping
ok('V6 stamp-assets.js knows about the clip', /HERO_CLIP\s*=\s*'video\/reel\.mp4'/.test(stamp) && /stamp\(MEDIA,\s*hashBytes\)/.test(stamp),
  'the clip has to be stamped as bytes: it is the one asset swapped in place, so its URL has to change with it');
ok('V6 the clip is .gitattributes binary', /^\*\.mp4\s+binary\s*$/m.test(read('.gitattributes')),
  'a .mp4 that git or an editor is allowed to treat as text is how a clip gets replaced with U+FFFD');

if (tagBlock && installed) {
  const want = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, CLIP))).digest('hex').slice(0, 8);
  const got = (/<source\s+src="[^"]*\?v=([0-9a-f]+)"/.exec(tagBlock[0]) || [])[1];
  ok('V6 stamped clip URL matches the bytes on disk', got === want,
    'src has ?v=' + (got || '(none)') + ' but sha1(' + CLIP + ') starts ' + want +
    ' - run "node stamp-assets.js" and commit index.html');
} else {
  skip('V6 stamped clip URL matches the bytes on disk', installed ? 'no tag to read' : 'no clip installed yet (the src stays bare)');
}

// ------------------------------------------------------- the container itself
if (!clipThere) {
  ['F1 is really an MP4', 'F2 has not been through a text pipeline', 'F3 duration and picture size are readable', 'F4 fits a static host']
    .forEach((n) => skip(n, 'no clip at ' + (process.argv[2] ? clipFile : CLIP) + ' - the hero is the still image, as designed'));
} else {
  const buf = fs.readFileSync(clipFile);
  const mb = buf.length / 1048576;

  const brand = buf.toString('latin1', 4, 8) === 'ftyp' ? buf.toString('latin1', 8, 12) : null;
  const has = (s) => buf.indexOf(Buffer.from(s, 'latin1')) > -1;
  ok('F1 is really an MP4 (ftyp brand ' + (brand || 'none') + ')',
    brand === 'isom' || brand === 'mp42' || brand === 'mp41' || brand === 'avc1' || brand === 'M4V ',
    'first bytes should be 00 00 00 20 66 74 79 70 (ftyp)');
  ok('F1 has both a moov and an mdat box', has('moov') && has('mdat'),
    'a file with a valid header but no moov/mdat is a header with nothing behind it');

  // U+FFFD is three bytes, so in an ~18 MB clip it turns up by chance about once; a
  // clip that has been decoded as UTF-8 and re-encoded contains millions, in runs.
  const bad = Buffer.from('efbfbd', 'hex');
  let nth = buf.indexOf(bad); let count = 0; let run = 0; let worst = 0; let prev = -99;
  while (nth !== -1) {
    count += 1;
    run = nth === prev + 3 ? run + 1 : 1;
    if (run > worst) worst = run;
    prev = nth; nth = buf.indexOf(bad, nth + 1);
  }
  ok('F2 has not been through a text pipeline (' + count + ' U+FFFD, longest run ' + worst + ')',
    count < 500 && worst < 3,
    'this many replacement characters means the bytes were decoded as text and re-encoded: the browser will answer DEMUXER_ERROR_COULD_NOT_OPEN. Re-export or re-copy the file - it cannot be repaired from here');

  // mvhd carries the timescale and the duration; tkhd carries the picture size. Both are
  // "full boxes", so a version 1 body is 12 bytes longer than a version 0 body, and the
  // width/height pair is the last thing in the box. That matters here: the clip the owner
  // re-encodes with ffmpeg comes out as version 0 while Chrome's recorder writes version
  // 1, so one hard-coded offset is always wrong for the other. Being four bytes out is
  // also silent rather than fatal - it reads the height as the width and the length of
  // the next box as the height, which looks like a real answer ("720x0"). So the offset
  // is checked against the box's own declared length, and a track with no picture (the
  // audio track of a clip exported with sound) is skipped instead of reported.
  const boxStart = (name, from) => { const i = buf.indexOf(Buffer.from(name, 'latin1'), from || 0); return i < 4 ? -1 : i - 4; };
  let seconds = NaN; let w = 0; let h = 0; let why = '';
  try {
    const mvhd = boxStart('mvhd');
    const v = buf[mvhd + 8];
    const timescale = buf.readUInt32BE(mvhd + 8 + (v ? 20 : 12));
    const duration = v ? Number(buf.readBigUInt64BE(mvhd + 8 + 24)) : buf.readUInt32BE(mvhd + 8 + 16);
    seconds = duration / timescale;
    for (let tkhd = boxStart('tkhd'); tkhd !== -1; tkhd = boxStart('tkhd', tkhd + buf.readUInt32BE(tkhd))) {
      const end = tkhd + buf.readUInt32BE(tkhd);
      const bt = tkhd + 8 + (buf[tkhd + 8] ? 88 : 76);
      if (bt + 8 > end) throw new Error('tkhd is ' + (end - tkhd) + ' bytes, too short for a picture size at +' + (bt + 8 - tkhd) + ' - the offset and the box do not agree');
      const cw = Math.round(buf.readUInt32BE(bt) / 65536);
      const ch = Math.round(buf.readUInt32BE(bt + 4) / 65536);
      if (cw > 0 && ch > 0) { w = cw; h = ch; break; }
    }
  } catch (err) { why = ' (' + err.message + ')'; }
  ok('F3 duration and picture size are readable (' + (isNaN(seconds) ? 'n/a' : seconds.toFixed(1) + 's') + ' ' + w + 'x' + h + ')',
    seconds >= 1 && seconds <= 90 && w >= 320 && h >= 180,
    'expected a clip of roughly 1-90 seconds with a real picture size; a 0x0 or NaN result means the movie header is not intact' + why);

  ok('F4 fits a static host (' + mb.toFixed(1) + ' MB)', mb < 100,
    'GitHub Pages refuses files of 100 MB or more, so this would not even deploy');
  if (mb >= 6) {
    notes.push('F4 ' + mb.toFixed(1) + ' MB is a big first impression: the clip loops muted for every visitor who reaches the hero, and mobile data is not free. Re-encoding to ~720p H.264 usually lands near 1-2 MB, e.g.  ffmpeg -i in.mp4 -vf scale=1280:-2 -c:v libx264 -crf 27 -preset slow -movflags +faststart -an video/reel.mp4');
  }
}

const fails = results.filter((r) => !r.pass && !r.skipped);
results.forEach((r) => {
  if (r.skipped) console.log('SKIP  ' + r.name + '   [' + r.why + ']');
  else console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']'));
});
notes.forEach((n) => console.log('NOTE  ' + n));
console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length +
  ' SKIP=' + results.filter((r) => r.skipped).length);
process.exit(fails.length ? 1 : 0);