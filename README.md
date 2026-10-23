# Random Stock

A small friends & family sneaker vault at **randomstock.shop** — 102 listings, one page
each, no cart and no checkout. A pair is claimed by call or text, so the site's job is to
show the photos, the size and the condition clearly, and to make the number impossible to
miss.

Plain HTML, CSS and JavaScript on GitHub Pages. No `package.json`, no bundler, no build
server, no request-time code. Node regenerates files that are then committed; Python
rebuilds the catalog from the original spreadsheet; nothing runs when a visitor asks for a
page.

## The files worth knowing

| Path | What it is |
|---|---|
| `index.html` | The page. Structure only — but three regions inside it are written by scripts: the `?v=` asset URLs (`stamp-assets.js`), the `catalog-jsonld` block (`build-jsonld.js`), and the `hero-video` marker pair (`stamp-assets.js`). Edit around those markers, never inside them. |
| `app.js` | Store logic: rendering, routing, search, filters, dialogs. Holds the order number. |
| `boot.js` | The two extras that used to be inline at the end of `<body>`: the visit counter and the service-worker registration. |
| `products.js` | **The catalog. This is the file to edit for any listing change.** |
| `slugs.js` | The one slug rule. `app.js`, `jsonld.js` and `prerender-products.js` all read it, so a pair's address is the same in a card's link, in the structured data, and as a folder on disk. |
| `jsonld.js` | Listing → schema.org. Used by the live page *and* by the build step, so the baked-in copy and the runtime copy cannot drift. |
| `styles.css` | All styling. |
| `fonts/` | The two type families, served from this domain: `fonts.css` (2 KB of `@font-face`) plus one variable Manrope and three DM Mono woff2 files, latin subsets, 70 KB total. No request to `fonts.googleapis.com` on any page. |
| `sw.js` | Service worker with one job: navigations are fetched `no-store`, so a returning visitor never runs the previous deploy's HTML. |
| `prerender-products.js` | Writes `product/<slug>/index.html` for every listing, and `sitemap.xml`. |
| `redirects.js` | Retired addresses: old slug → SKU. `prerender-products.js` leaves a small "moved" page at each one, because a static host cannot answer an old URL with a 301. Add an entry whenever a slug changes. |
| `stamp-assets.js` | Rewrites the `?v=` hashes in `index.html`. |
| `build-jsonld.js` | Bakes the catalog's structured data into `index.html`. |
| `build-images.js` | Responsive AVIF/WebP/JPEG for the hero and the two category tiles. The only script with a dependency (`sharp`). |
| `product/` | **Generated.** One directory per listing. Do not hand-edit. |
| `sitemap.xml` | **Generated** by `prerender-products.js`. One `<url>` per listing, each with its own photo. |
| `robots.txt` | Allows everything and names the sitemap, so link unfurlers never have to guess. |
| `_config.yml` | Pages builds this branch with Jekyll, so this is where the repo documents (`README.md`, `AGENTS.md`) are kept out of the published site. It does not affect `index.html`, `product/`, `sitemap.xml` or any asset. |
| `sneaker_images/` | Source photos, plus `square/` — each photo padded to a 1:1 canvas so a card's `object-fit: cover` can never clip a shoe. |
| `images/` | The hero and the two category tiles, each at three widths in AVIF/WebP/JPEG — plus `images/clothing/`, the full-size photos the clothing and headwear listings point at directly (they are product photos, not page furniture, so `build-images.js` does not touch them). |
| `video/reel.mp4` | The hero clip. The page falls back to a still image when it is absent or undecodable. |
| `test-*.js` | Eleven suites. Plain Node, no dependencies, ~12 s for all of them. |
| `.github/workflows/stamp-assets.yml` | The only workflow that touches the site. |
| `tools/visit-counter-worker.js` | Optional Cloudflare Worker that counts page views. This repo does not deploy it. |
| `tools/ci-status.js` | Prints the newest Actions runs, polling in chunks small enough to survive a 30-second command cap. `node tools/ci-status.js --wait 20`; exit `3` means look again. |

## Run it locally

Serve it — `file://` breaks relative paths, the service worker, and every
`/product/<slug>/` page:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Add or change a listing

1. Put the photo in `sneaker_images/` — 600×600 (see *Photos* below). Clothing and headwear
   photos go in `images/clothing/` instead, and skip step 2.
2. Rebuild the square derivative: `python3 repad_squares.py`
3. Add one object to `localProducts` in `products.js`:

   | Field | Notes |
   |---|---|
   | `id` | Unique. `validate-catalog.js` also expects 1..N with no gaps. |
   | `brand` | Drives the brand tiles and, with no `category`, whether it counts as a sneaker. |
   | `name` | Shown on the card and used to build the page title, `<h1>` and slug. |
   | `color`, `condition`, `box` | `New`, `Original Box`, and so on — all rendered on the listing page. |
   | `sizes` | Array of strings as the label reads, e.g. `["9.5"]`, `["7", "7 1/8"]`. |
   | `sizeGroup` | Optional. Only when the size strings alone cannot say which run a listing is in (`Men`, `Women`, `Youth`, `Apparel`, `Headwear`). |
   | `img` | Path from the site root, e.g. `sneaker_images/square/Foo.jpg`. `app.js` runs it through `assetURL()` so it resolves from `/product/<slug>/` too. |
   | `gallery` | Photos the viewer steps through. Keep `img` first in it. |
   | `sku` | The style code. Part of the page title and the slug. |
   | `category` | Optional: `"clothing"` or `"random"`. Anything without one is a sneaker. |

4. Regenerate what is derived from the catalog, **in this order**:

   ```bash
   node stamp-assets.js
   node build-jsonld.js
   node prerender-products.js
   ```

5. Run the suites:

   ```bash
   for f in test-*.js; do node "$f" || break; done
   ```

6. Commit `products.js`, `index.html`, `product/` and `sitemap.xml` **together**. Splitting
   them is how the pages and the shop start disagreeing.

CI repeats step 4 on every push to `main` and commits whatever was stale, so a listing edit
that skips it still lands. But the push then carries a second commit from the bot, and a
broken assertion shows up after `main` has already moved instead of before.

## Photos

Source sneaker photos are 600×600, which is smaller than the ~1200px Google wants for
large image previews. That is a source-file limitation — no derivative can invent pixels.
The clothing and headwear photos in `images/clothing/` are larger (1024–1200 on the long
edge) but are not square, which is why they are not run through `repad_squares.py`.

`build-images.js` is the only script that needs an install:

```bash
npm i sharp && node build-images.js
```

Its output is committed, so the site itself never builds an image.

## Tests

Eleven suites, no framework, no install:

```bash
for f in test-*.js; do echo "== $f"; node "$f"; done
```

| Suite | Covers |
|---|---|
| `test-product-pages.js` | The `/product/<slug>/` files: one per listing, each naming its own pair in title, description, canonical, gallery, price-free structured data and sitemap entry — plus one `<h1>` per page, descriptions ≤160 characters, and every advertised photo existing on disk. |
| `test-mobile.js` | Small-screen layout and tap targets. |
| `test-route.js` | Path routing, and the hash fallback for pages without a real path. |
| `test-zoom.js` | The photo zoom viewer. |
| `test-size-search.js` | Size search and the filter's behaviour. |
| `test-listing-qr.js` | The QR code a listing can show for sharing. |
| `test-brand-tiles.js` | Brand and category tiles, the announcement bar, the vault title. |
| `test-reveal.js` | The card scroll-reveal — every renderer arms it, so a grid can never be invisible. |
| `test-hero-video.js` | The hero clip: the tag is on only when the file is really a video. |
| `test-images.js` | Every width and format the hero and tile `srcset`s name actually exists on disk — a `srcset` is a list of URLs nothing validates at runtime. |
| `test-privacy.js` | The order number is not sitting in the shipped files. |

Each prints `PASS`/`FAIL` lines and ends with `TOTAL=<n> FAIL=<n>`. A `FAIL` is a merge
blocker.

## Deploying

Push to `main`; GitHub Pages serves it, `CNAME` points at `randomstock.shop`.

Pages sends `Cache-Control: max-age=600` for HTML and offers no way to change that header,
which is why two odd-looking things exist:

- `stamp-assets.js` gives every changed asset a new `?v=` URL, so a stale copy sits behind
  a URL nobody requests any more.
- `sw.js` fetches navigations with `cache: "no-store"`, so the HTML's own inline handlers
  and asset URLs always belong to the same deploy.

The other four workflows (`auto-bot.yml`, `cline-responder.yml`, `manual-test.yml`,
`test-trigger.yml`) exist for issue replies and AI experiments; none of them touch the site.

## Decisions that are deliberate

Listed so they do not get "fixed" by accident. Each one has a reason above it somewhere in
the code.

- **No prices anywhere.** Friends and family; the price is settled by text. The Product
  markup therefore carries an Offer with `availability` and no `price`, which means
  Search Console will report "Missing field 'price'" — expected, and why price/availability
  rich results are not a goal.
- **No `<lastmod>` in the sitemap.** Nothing records when a listing last changed, and a
  build-time "today" would rewrite all 103 entries on every commit and teach a crawler to
  ignore the field.
- **`changefreq` and `priority` stay**, even though Google ignores both.
- **No `<VideoObject>`** for the hero clip: it is decoration, and markup claiming otherwise
  would be a lie.
- **No visible "more pairs" rail** on listing pages. Discovery is the sitemap plus manual
  "Request indexing".
- **One `<h1>` per page**, and on a listing it is the pair's name. The homepage headline is
  `<h1>` in `index.html` and steps down to `<h2>` in the generated pages, which is why the
  `.hero` CSS rule lists both tags.
- **Descriptions stay ≤160 characters** (`A7` for listings, `A19` for the homepage).
- **The order number never appears in shipped markup.** It lives in `app.js`, split into
  groups, and is assembled at runtime for the dialer and the lede.
- **A renamed listing keeps its old address working.** The slug comes from the name
  (`slugs.js`), so fixing a name moves the page; `redirects.js` maps the retired slug to its
  SKU and the build leaves a "moved" page there — canonical, meta refresh and a plain link,
  which is the only redirect a static host can offer. A pair that leaves the catalog takes
  its stub with it. `A20`-`A23` hold that together.

