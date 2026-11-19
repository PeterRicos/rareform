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
  'wmns-jordan-1-high-og-black-metalic-cd0461-001': 'CD0461-001',
  // Critique round 2 (2026-10-25): names corrected, so their pages moved.
  // "WMNS" → "Women's", four listings.
  'wmns-air-jordan-1-low-dc0774-114': 'DC0774-114',
  'wmns-jordan-1-high-og-silver-toe-cd0461-001': 'CD0461-001',
  'wmns-jordan-3-retro-sp-a-ma-maniere-dh3434-110': 'DH3434-110',
  'wmns-travis-scott-air-force-1-white-white-dd8959-100': 'DD8959-100',
  // "RetroRaging" → "Retro Raging".
  'jordan-5-retroraging-bull-red-2021-gs-440888-600': '440888-600',
  // The two AJ12 GS listings, finally named for their colorways — identified from
  // the listing photos and confirmed against the GS style codes (153265-070
  // University Gold, DH0905-005 Dark Concord).
  'air-jordan-12-retro-grade-school-153265-070': '153265-070',
  'air-jordan-12-retro-grade-school-dh0905-005': 'DH0905-005',
  // Catalog cleanup: full model + colorway names for generic or mismatched titles,
  // verified against style codes and listing photos.
  'women-s-air-jordan-1-low-dc0774-114': 'DC0774-114',
  'air-jordan-1-retro-high-og-555088-404': '555088-404',
  'hyper-royal-light-smoke-grey-white-575441-402': '575441-402',
  'jordan-1-lucky-green-white-sail-black-db4612-300': 'DB4612-300',
  'jordan-4-retro-gs-white-cement-dj4699-100': 'DJ4699-100',
  'jordan-4-white-cement-ct8527-100': 'CT8527-100',
  'air-max-90-cw6018-001': 'CW6018-001',
  'air-jordan-1-low-grade-school-553560-606': '553560-606',
  'air-jordan-1-retro-high-og-555088-032': '555088-032',
  'air-jordan-1-retro-high-og-555088-033': '555088-033',
  'air-jordan-5-retro-grade-school-cz2989-001': 'CZ2989-001',
  'jordan-1-high-og-preschool-cu0449-300': 'CU0449-300',
  'jordan-1-high-og-toddler-cu0450-300': 'CU0450-300',
  'jordan-1-retro-high-og-toddler-aq2665-063': 'AQ2665-063'
};
