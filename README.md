# DiscoveryFTP (DFLIX) → Stremio addon

Same architecture as the DhakaFlix version: a local scraper builds an index,
the addon (hosted free) serves it, your device resolves the BDIX links
directly when you hit play.

Unlike DhakaFlix, this site already has clean titles/years/genres — no
filename-guessing needed, so matching against Cinemeta is exact.

## The catalog is big — two-stage crawl

The English category alone has **412 pages** (~16,000 movies), and that's
one of six categories. So this is split in two so you can checkpoint and
resume rather than lose hours of progress to one crash:

**Stage 1 — listing.** Walks `/m/category/{lang}/{page}` and records every
movie's id, title, year, and quality tag. Fast — one page = ~40 movies.

```bash
node scrape-listing.mjs --categories English --max-pages 5   # quick test
node scrape-listing.mjs                                       # full crawl, all categories
```

**Stage 2 — details.** For each id from stage 1, visits `/m/view/{id}` to
get the actual playable file URL (this isn't on the listing page). This is
the slow part — one request per movie.

```bash
node scrape-details.mjs --limit 200   # quick test
node scrape-details.mjs               # everything remaining
```

Both scripts checkpoint to disk every ~60 items and skip anything already
done, so **Ctrl+C and re-running is always safe** — you never lose more than
a minute of progress.

Recommended order for a first run:

```bash
node scrape-listing.mjs --categories English --max-pages 3
node scrape-details.mjs --limit 50
npm start        # sanity-check the addon works with a tiny index
# looks good? now do it for real, ideally overnight:
node scrape-listing.mjs
node scrape-details.mjs
```

## Test locally

```bash
npm start
# → http://127.0.0.1:7001/manifest.json
```

Add that URL in Stremio Desktop/Android. `notWebReady: true` is set, so use
the desktop or mobile app, not Stremio Web.

## Deploy free

Same as before — push to GitHub, import at vercel.com, done. Watch
`index.json`'s size; if it exceeds Vercel's bundle limit with the full
catalog, only crawl the categories/years you actually watch (`--categories
English,Hindi`), or split the index and load per-category.

## Known gaps

- **Series aren't implemented yet.** The `/s/...` path structure hasn't been
  confirmed — paste a series category page's source (e.g. whatever
  `/s/category/English` looks like) and I'll add it the same way.
- If a `/m/view/{id}` page doesn't have a direct-download `<a title="...">`
  link (a few pages seem to omit it, e.g. when only a "Stream"/"WEB Play"
  option exists), that id is silently skipped in stage 2. Worth checking how
  many get skipped after a full crawl.
