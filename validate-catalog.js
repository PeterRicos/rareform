// validate-catalog.js — structural checks for the catalog block (products.js)
const fs = require('fs');
const h = fs.readFileSync(__dirname + '/products.js', 'utf8');

const ids = [...h.matchAll(/^\s*id:\s*(\d+),\s*$/gm)].map(m => +m[1]);
const uniq = new Set(ids);
const dense = ids.length === uniq.size && ids.every((v, i) => v === i + 1);
console.log('ids count=' + ids.length + ' unique=' + uniq.size + ' dense1..N=' + dense + ' max=' + (ids[ids.length - 1] || 0));

const skus = [...h.matchAll(/sku: "([^"]+)"/g)].map(m => m[1]);
console.log('sku count=' + skus.length + ' uniqueSkus=' + new Set(skus).size);

const imgs = [...h.matchAll(/img: "([^"]+)"/g)].map(m => m[1]);
const local = imgs.filter(s => s.startsWith('sneaker_images/'));
const sq = imgs.filter(s => s.startsWith('sneaker_images/square/'));
const missing = local.filter(s => !fs.existsSync(__dirname + '/' + s));
console.log('img refs=' + imgs.length + ' local=' + local.length + ' square=' + sq.length +
  ' nonSquare=' + (local.length - sq.length) + ' missingFiles=' + missing.length);

const g = [...h.matchAll(/gallery: \["([^"]+)"/g)].map(m => m[1]);
const gmiss = g.filter(s => !fs.existsSync(__dirname + '/' + s));
console.log('gallery refs=' + g.length + ' missing=' + gmiss.length);

const bad = ['id: 100', 'U990GR6', '1201A019-108', 'FD2370-101', 'DM7866-162', 'CU9225-100']
  .filter(s => h.includes(s));
console.log('placeholder/removed-SKU hits: ' + (bad.length ? bad.join(', ') : 'none'));

// These style codes appear once in img, once in gallery and once in sku, so count
// sku declarations — a raw substring count always reports 3 and reads as a dupe.
const bone = [...h.matchAll(/sku: "[^"]*HQ6316[^"]*"/g)].length;
console.log('HQ6316 SKU entries (expect 1 = generated Bone listing): ' + bone);
const fz = [...h.matchAll(/sku: "[^"]*FZ5000[^"]*"/g)].length;
console.log('FZ5000 SKU entries (expect 1 = deduped): ' + fz);

const pricing = (h.match(/price|retail|money\(|\$[0-9]/gi) || []).length;
console.log('pricing refs (expect 0): ' + pricing);

// The catalog JSON-LD that ships inside index.html has to describe the same
// listings as products.js. build-jsonld.js writes it and the stamp-assets workflow
// keeps it current, so this only ever fires on a stale commit or a hand edit.
const page = fs.readFileSync(__dirname + '/index.html', 'utf8');
const block = /<!-- catalog-jsonld:begin -->[\s\S]*?<script type="application\/ld\+json">([\s\S]*?)<\/script>[\s\S]*?<!-- catalog-jsonld:end -->/.exec(page);
if (!block) {
  console.log('catalog jsonld: MISSING — run "node build-jsonld.js"');
} else {
  const list = (JSON.parse(block[1])['@graph'] || []).filter(n => n['@type'] === 'ItemList')[0];
  const items = list ? list.itemListElement : [];
  const listed = new Set(items.map(e => e.item && e.item.sku));
  const absent = skus.filter(s => !listed.has(s));
  const priced = items.filter(e => e.item && e.item.offers && 'price' in e.item.offers).length;
  console.log('catalog jsonld: items=' + items.length + '/' + skus.length +
    ' listedSkusMissing=' + absent.length + (absent.length ? ' (' + absent.slice(0, 3).join(', ') + ')' : '') +
    ' priced=' + priced + ' (expect 0 while the catalog has no prices)');
}