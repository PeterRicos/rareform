# AGENTS.md

Working notes for AI agents and automation in this repo. `README.md` explains what the site
is; this file explains the rules. The site is live and friends and family order from it, so
the bar is "it still works on a phone", not "the diff looks right".

## Ship without being asked

The owner of this repo has said, in as many words, that a finished change should be merged
and pushed without waiting to be told. So the flow runs end to end in one pass:

1. make the change
2. regenerate whatever derives from it (below)
3. run all eleven suites — a `FAIL` means stop and fix it, not ship it
4. commit on a branch — never commit to `main` directly
5. `git ship` — fetch → push the branch → `--ff-only` merge into `main` → push `main`
6. confirm the deploy with `node tools/ci-status.js --wait 20` (see *Waiting on CI*)
7. report the sha, `git show --stat`, what the suites printed, and what the deploy did

`main` is live at randomstock.shop about a minute after the push, which is why step 6 is part
of the job rather than a courtesy.

Two habits keep this safe now that no one is gatekeeping. `git ship` refuses a dirty tree and
refuses to run on `main`, so the commit always lands on a branch first. And `stamp-assets.yml`
commits to `main` by itself after a site change, so never force-push and never rewrite `main`:
to undo something that shipped, `git revert <sha>` and ship the revert.

Ask only when the answer is genuinely the owner's to give — a price, a photo, whether a
listing should be public at all, or a slug rename that moves an already-indexed URL.

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

## The live sweep

Those suites read the shipped files; `tools/sweep-live.js` is the one check that loads the
shop in headless Chrome and taps it — each hero category, then every brand tile, at 390px
and 1280px — failing when a tile with stock behind it answers empty. It exists because of a
bug no static suite could see: `shopCategory()` left its category on `shopCategoryFilter`,
`filterByBrand()` never cleared it, and no control in the filter bar shows a category, so
after SHOP SNEAKERS every non-sneaker brand read as out of stock. Every file was correct on
its own; only the order of two clicks was wrong.

```bash
node tools/sweep-live.js --width=390        # ~9s, the shipped page
node tools/sweep-live.js --base=http://127.0.0.1:8000/index.html   # a local copy
```

`.github/workflows/live-sweep.yml` runs it after a successful Pages deploy, weekly, and by
hand. It needs Chrome and Node 22+ (the DevTools driver uses the global `WebSocket`; there is
no puppeteer and nothing to install). Two things it cannot do: it is the only check that
depends on the network, so a red run there is not automatically a site problem — read the
check names before believing it — and it proves the *deployed* page, so run it after a push,
not before.

Never point it at a page you have not deployed and call the result a pass.

## Waiting on CI

The shell an agent works through here kills a foreground command after about thirty
seconds, and `gh` is not installed — so neither `gh run watch` nor a bare `sleep 60` can be
used to wait for the Pages build. Wait in a chunk that fits inside the cap:

```bash
node tools/ci-status.js --wait 20   # exit 0 green · 1 failed · 3 still running · 2 unreadable
```

Repeat the same command while it exits `3`. A docs-only push finishes well inside a minute,
so two or three calls is normal. Add `--sha <prefix>` to watch one commit instead of the
newest runs — a second workflow landing on the same sha means the top row is not always the
run you pushed. Exit `3` with *no* run listed is a real answer rather than an error: either
it is the first half-minute after a push, or the commit fell outside `stamp-assets.yml`'s
`paths:` filter and will never have a run.

The runs API allows 60 unauthenticated calls an hour per IP, so the script polls every eight
seconds; at the `--wait 24` ceiling that is at most four calls per invocation. Export
`GITHUB_TOKEN` if a loop is going to run long. Do not push `--wait` further — the cap
applies to the whole command, network time included.

The verdict is per workflow, taken from its newest run, because one push can start two: the
Pages build, then the stamp commit's own Pages build, and `concurrency: cancel-in-progress`
kills the first one on purpose. Those show up marked `superseded` and do not turn exit `0`
into a failure. A failed *newest* run still exits `1` and names the workflow and conclusion.

## Do not "improve" these — each was decided on purpose

- **No prices.** No `price` in a listing, no `Offer.price` in the structured data, no price
  field in the page toolbar. Friends and family settle the price by text. Search Console's
  "Missing field 'price'" on the product markup is expected and must not be "fixed".
- **Type stays on this domain.** `fonts/fonts.css` plus four woff2 files. Do not put a
  Google Fonts `<link>` (or its preconnects) back into `index.html`: it re-adds two DNS/TLS
  round-trips, a render-blocking stylesheet before the first word paints, and a third-party
  request on every page of a shop that otherwise talks to nobody.
- **No `<lastmod>` in the sitemap**, and leave `changefreq`/`priority` alone.
- **No `<VideoObject>`** for the hero clip. It is decoration.
- **No visible "more pairs" link rail** on listing pages. It was offered and declined;
  discovery is the sitemap plus manual "Request indexing" in Search Console.
- **One `<h1>` per document.** The homepage headline is `<h1>` in `index.html` and `<h2>` in
  the generated pages — do not "unify" that, and keep both tags listed in the `.hero` CSS
  rule so navigating back to the home view looks unchanged.
- **Descriptions ≤160 characters** (`A7` listings, `A19` homepage).
- **Slugs are addresses, not labels.** The slug is derived from the name (`slugs.js`), so a
  rename moves an indexed URL. Renaming is allowed; renaming *silently* is not — add the
  retired slug → SKU to `redirects.js` in the same commit. `prerender-products.js` leaves a
  "moved" page at the old address and a static host has no other redirect, so that file is
  what keeps old links alive.
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
  number (`A19`, `W4`, `P7`), not a new file — a new file is for a new area, like fonts.
- Do not judge a font by searching its bytes. WOFF2 stores a known table tag (`fvar` among
  them) as a flag byte, so `grep fvar` reports nothing for a genuinely variable font, which
  is a whole false alarm about bold text. Read the directory (`test-fonts.js` does) or leave
  it to the suite.

## Fastest way to understand a feature

Read the suite that covers it. `test-product-pages.js` says what a listing page owes a
crawler, `test-mobile.js` says what it owes a thumb, `test-privacy.js` says what it must not
contain, `test-fonts.js` says what the type owes nobody. The tests are the specification;
the prose comments are the reasoning.
