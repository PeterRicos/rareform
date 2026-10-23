// redirects.js — addresses that used to be a listing's page, and still have to work.
//
// A slug is derived from the listing's name (slugs.js), so correcting a name moves the
// page with it. GitHub Pages is a static host: no server, no redirect rules, no way to
// answer an old path with a 301. The only thing that keeps an old address alive is a page
// still sitting at it, so prerender-products.js writes a small "moved" page for every
// entry here — same folder the listing used to occupy, so every link, bookmark and search
// result that was already out there lands on the pair instead of a 404.
//
// Keyed by the retired slug, valued by SKU. Never by the new slug: the SKU is the part of
// a listing that survives a rename, so the destination is looked up in the live catalog
// each time the pages are built. Rename the pair again and the stub follows the new name;
// drop it from products.js and the stub is pruned along with its page, rather than
// pointing at nothing.
//
// Add an entry whenever a slug changes, for any reason. If the old name is gone from the
// file, git still has it: `git log --diff-filter=D --name-only -- product` lists the
// folder that went away.
module.exports = {
  // "Womans" → "Women's", two listings. An apostrophe becomes a hyphen in a slug, which
  // is why the new address reads "women-s".
  'womans-nike-dunk-low-og-yellow-strike-dm9467-700': 'DM9467-700',
  'womans-nike-dunk-low-white-rose-whisper-dd1503-118': 'DD1503-118',
  // "Black/Metalic" → "Silver Toe": CD0461-001 is the Silver Toe, and the color field
  // already said so. The name was the odd one out, not the photo.
  'wmns-jordan-1-high-og-black-metalic-cd0461-001': 'CD0461-001'
};
