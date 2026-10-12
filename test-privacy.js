/* Privacy harness: the shop's phone number must not be readable out of the repo or
   the raw HTML (same folder).
   Run: node test-privacy.js     (or: node rareform/test-privacy.js)

   The storefront answers orders by phone and text, so a real number has to reach a
   shopper's dialer. It does not follow that the number has to sit in the shipped
   files as a string: this repo is public, and index.html is what a crawler, a bot or
   a `curl` gets without ever running JavaScript. A number written out whole is one
   regex away from somebody's list, and the page has no use for the pretty form of it
   that a scraper wants.

   So the digits live in exactly two places, split into three groups and joined at
   runtime — app.js (the page and its dialer links) and jsonld.js (the structured
   data; they never load together in the harnesses, so each keeps its own copy) — and
   nothing else. What this suite pins:

     - no shipped file names the number in plain text, in any of the forms worth
       scraping: the E.164 form, the bare digits, the 3-4 split, the display form
     - the two group copies agree, so the dialer, the order dialog and the structured
       data can never name different numbers
     - what the groups assemble into is still a dialable US number — the split must
       not get "tidied" into a wrong number
     - the catalog JSON-LD baked into index.html carries no telephone at all, so the
       no-JavaScript fetch names nothing; the live page still builds it, which is also
       pinned here, because a fix that hid the number from shoppers too would be a
       worse bug than the one it fixed
     - a sweep of every text file in the repo, so the next leak is caught wherever it
       lands, not only in the three files that leaked this time

   Out of scope on purpose: git history. The number is still in the commits that put
   it there (and in the public GitHub history), and this file — which reads files, not
   commits — cannot say otherwise. Scrubbing that is a rewrite and a force-push, a
   decision for the repo owner, not a test.                          */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const results = [];
const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: cond ? '' : String(extra) });

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('index.html');
const app = read('app.js');
const jsonldSrc = read('jsonld.js');

// The digits come out of jsonld.js rather than being written here: a harness that
// spelled the number out would be the very leak it is supposed to catch.
const structuredData = require('./jsonld.js');
const GROUPS = structuredData.PHONE_GROUPS;
const PHONE = structuredData.PHONE;
const DIGITS = GROUPS.join('');
const TAIL = GROUPS[1] + '-' + GROUPS[2];

// Every form a scraper's regex would look for. The display form is the one a plain
// `[\d\s().+-]{10,}` swat would take off the rendered page anyway, so it counts as
// scrapable even though it is "just the pretty version".
const NEEDLES = [PHONE, DIGITS, TAIL, structuredData.PHONE_DISPLAY];

function named(text) {
  return NEEDLES.filter((n) => text.indexOf(n) !== -1);
}

// ---- 1. the three files that shipped the number ------------------------------
[['index.html', html], ['app.js', app], ['jsonld.js', jsonldSrc]].forEach(([name, text]) => {
  const found = named(text);
  ok('P1  ' + name + ' names no phone number in plain text', found.length === 0,
    found.length + ' scrapable form(s) present, e.g. "' + (found[0] || '') + '"');
});

// ---- 2. the two copies agree -------------------------------------------------
// app.js is browser code, so its copy is read out of its source the way a reader
// would: the one array literal it keeps the groups in.
const appGroupsMatch = app.match(/const ORDER_PHONE_GROUPS = \[([^\]]*)\]/);
const appGroups = appGroupsMatch
  ? appGroupsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  : [];
ok('P2  app.js and jsonld.js hold the same three groups, in the same order',
  appGroups.length === 3 && appGroups.join('|') === GROUPS.join('|'),
  'app.js=' + appGroups.join('/') + ' jsonld.js=' + GROUPS.join('/'));

// Both files must assemble the number rather than spell it out, or the P1 checks
// would pass today and fail the moment somebody re-adds the literal.
ok('P2b each file builds the number from its groups (joined, not typed)',
  /ORDER_PHONE = '\+1' \+ ORDER_PHONE_GROUPS\.join\(''\)/.test(app)
  && /PHONE = '\+1' \+ PHONE_GROUPS\.join\(''\)/.test(jsonldSrc),
  'the join is missing from one of the two files');

ok('P2c app.js builds the display form from the groups too',
  /ORDER_PHONE_DISPLAY = '\(' \+ ORDER_PHONE_GROUPS\[0\]/.test(app),
  'display form no longer derived from the groups');

// ---- 3. the number the groups assemble is still a real one -------------------
ok('P3  the groups assemble into a dialable US number',
  /^\+1[2-9]\d{9}$/.test(PHONE) && GROUPS.every((g) => /^\d+$/.test(g))
  && GROUPS[0].length === 3 && GROUPS[1].length === 3 && GROUPS[2].length === 4,
  'shape check failed for the assembled number');

// ---- 4. the baked block carries no telephone, the live page still does -------
const BEGIN = '<!-- catalog-jsonld:begin -->';
const END = '<!-- catalog-jsonld:end -->';
const start = html.indexOf(BEGIN);
const end = html.indexOf(END);
const block = start !== -1 && end > start ? html.slice(start, end) : '';
ok('P4  the catalog block baked into index.html carries no telephone',
  block.length > 0 && block.indexOf('"telephone"') === -1,
  block.length === 0 ? BEGIN + ' … ' + END + ' missing from index.html' : 'telephone found in the baked block');

// The runtime node is the other half of the contract: whichever path a crawler that
// does run JavaScript takes, the number is there.
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('products.js'), sandbox);
const listings = vm.runInContext('localProducts', sandbox);
const first = (listings || [])[0];
ok('P4b the live product node still hands a crawler the number',
  !!(first && structuredData.product(first).offers
    && structuredData.product(first).offers.seller
    && structuredData.product(first).offers.seller.telephone === PHONE),
  'offers.seller.telephone is not the shop number');
ok('P4c the live organization node still carries it, and the bake can still omit it',
  structuredData.organization().telephone === PHONE
  && structuredData.organization({ phone: false }).telephone === undefined,
  'organization() phone option no longer behaves');

// ---- 5. the dialer links are built from the one constant --------------------
// The order dialog and its QR payload have to keep taking the number from
// ORDER_PHONE; a re-typed literal in either is how this regresses.
ok('P5  every dialer link in app.js is built from ORDER_PHONE',
  /'tel:' \+ ORDER_PHONE/.test(app)
  && /'sms:' \+ ORDER_PHONE/.test(app)
  && !/tel:\+?1?[0-9]{10}/.test(app)
  && !/sms:\+?1?[0-9]{10}/.test(app),
  'a dialer link no longer comes from the constant');

// ---- 6. the number reaches the lede sentence at runtime, not from the markup ----
ok('P6  the order dialog fills its lede from the constant',
  /id="orderPhone"><\/b>/.test(html) && /initOrderLede[\s\S]{0,200}ORDER_PHONE_DISPLAY/.test(app),
  'the lede is not filled from ORDER_PHONE_DISPLAY');

// ---- 7. sweep the whole repo -------------------------------------------------
// The three files above are where the number was; this is what keeps it out of the
// next file somebody adds (a README, a tool, a workflow, a sitemap entry).
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.bmp', '.tif', '.tiff', '.mp4', '.mov', '.webm', '.m4v', '.mp3', '.wav',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.pdf', '.zip', '.gz', '.7z']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (!BINARY.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const leaks = [];
let scanned = 0;
for (const file of walk(__dirname, [])) {
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) continue;             // not text, whatever its name says
  scanned++;
  const text = buf.toString('utf8');
  if (named(text).length) leaks.push(path.relative(__dirname, file).split(path.sep).join('/'));
}

ok('P7  no text file in the repo names the number (' + scanned + ' scanned)',
  leaks.length === 0, leaks.join(', '));

const fails = results.filter((r) => !r.pass);
results.forEach((r) => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.pass ? '' : '   [' + r.extra + ']')));
console.log('\nTOTAL=' + results.length + ' FAIL=' + fails.length);
process.exit(fails.length ? 1 : 0);
