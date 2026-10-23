# AGENTS.md

Working notes for AI agents and automation in this repo. `README.md` explains what the site
is; this file explains the rules. The site is live and friends and family order from it, so
the bar is "it still works on a phone", not "the diff looks right".

## Pushing is a separate, explicit step

Implementing, regenerating, testing and committing are all fine. **Do not push, do not
merge into `main`, and do not run `git ship` unless the person you are working with asked
for it in that turn.** `main` deploys to randomstock.shop about a minute after the push.

The stop point:

1. make the change
2. regenerate whatever derives from it (below)
3. run all eleven suites
4. commit on a branch — never commit to `main` directly
5. report the sha, `git show --stat`, and what the suites printed
6. stop and wait

`git ship` is a configured alias for what happens when you *are* asked: fetch → push the
branch → `--ff-only` merge into `main` → push `main`. It refuses on a dirty tree and
refuses on `main`, so it is the safe form of the operation — not an implicit permission.

## Never hand-edit generated files

| Generated | Written by |
|---|---|
| `product/**/index.html`, `sitemap.xml` | `prerender-products.js` |
| the `catalog-jsonld` block in `index.html` | `build-jsonld.js` |
| the `?v=` query strings in `index.html` | `stamp-assets.js` |
| `sneaker_images/square/` | `repad_squares.py` |
| `images/*.{avif,webp,jpg}` | `build-images.js` |

Change the source — a `products.js` entry, the markup around the markers, the photo — and
regenerate. A hand-edited listing page is a page the next push silently overwrites.

## Regeneration order matters

```bash
node stamp-assets.js && node build-jsonld.js && node prerender-products.js
```

All three are idempotent, so running them is always safe. The order is not optional:
`prerender-products.js` copies `index.html` and therefore has to run *after* the stamping,
or every listing page would point at the previous deploy's stylesheet for ten minutes.

Two outputs tell you whether your change reached the pages: `prerendered listings=102
written=<n> unchanged=<n>`, and `sitemap=current` (versus a rewrite). If `<n>` is 0 after
you edited a listing, you edited the wrong thing.

## Every suite, every time

```bash
for f in test-*.js; do echo "== $f"; node "$f"; done
```

`FAIL` is a merge blocker. Never make a suite pass by weakening an assertion — those files
are the specification for behaviour nobody can see in a diff, and the comment above each
one says what it is protecting. If a decision genuinely changed, change the assertion *and*
its comment, and say so in the commit message.

## Do not "improve" these — each was decided on purpose

- **No prices.** No `price` in a listing, no `Offer.price` in the structured data, no price
  field in the page toolbar. Friends and family settle the price by text. Search Console's
  "Missing field 'price'" on the product markup is expected and must not be "fixed".
- **No `<lastmod>` in the sitemap**, and leave `changefreq`/`priority` alone.
- **No `<VideoObject>`** for the hero clip. It is decoration.
- **No visible "more pairs" link rail** on listing pages. It was offered and declined;
  discovery is the sitemap plus manual "Request indexing" in Search Console.
- **One `<h1>` per document.** The homepage headline is `<h1>` in `index.html` and `<h2>` in
  the generated pages — do not "unify" that, and keep both tags listed in the `.hero` CSS
  rule so navigating back to the home view looks unchanged.
- **Descriptions ≤160 characters** (`A7` listings, `A19` homepage).
- **Slugs are addresses, not labels.** `metalic` (one listing) and "Womans Nike Dunk Low"
  (two) are known and intentionally left alone. Changing a slug changes an indexed URL; it
  needs a `products.js` edit, a regenerate, and a heads-up.
- **Don't re-encode `video/reel.mp4`** — the current clip is a placeholder and the final cut
  is still coming. When it lands: 720p, no audio track, `-crf 26`, `-movflags +faststart`,
  target ≤1 MB, then `node stamp-assets.js`.

## Privacy

The order number is assembled at runtime from `ORDER_PHONE_GROUPS` in `app.js` and must not
appear as a literal in `index.html`, in a listing page, or in the sitemap. `test-privacy.js`
enforces it; if it fails, you have written the number somewhere it does not belong.

The visit counter (a Cloudflare Worker, `tools/`) records the page path and nothing else —
no IP, no user agent, no referrer. That is why there is no cookie banner. Keep it that way.

## Style

- Vanilla JS. No framework, no bundler, no `package.json`, no `node_modules` in the repo.
  Don't introduce one; `build-images.js` is the single script that ever needs an install.
- Shared libraries use the `(function (root, factory) { … })` wrapper so the same file runs
  as a `<script>` and through `require()` — that is how one slug rule can serve the page and
  the build step.
- Two-space indent, single quotes, semicolons. CSS is plain, with custom properties for
  colour.
- Comments explain **why**, and the existing files are dense with them. Match that density,
  and don't delete a comment whose decision still holds — most of them are the only record
  of a bug that was already paid for once.
- Test files are plain Node: `ok(name, condition, extra)` and a final `TOTAL=`/`FAIL=` line.
  A new assertion belongs in the series that already covers its area and takes the next
  number (`A19`, `W4`, `P7`), not a new file.

## Fastest way to understand a feature

Read the suite that covers it. `test-product-pages.js` says what a listing page owes a
crawler, `test-mobile.js` says what it owes a thumb, `test-privacy.js` says what it must not
contain. The tests are the specification; the prose comments are the reasoning.
