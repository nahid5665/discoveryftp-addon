#!/usr/bin/env node
/**
 * scrape-listing.mjs — Stage 1: walk /m/category/{lang}/{page} and collect
 * every movie's {id, title, year, quality, category}.
 *
 * This does NOT get the playable file URL — that requires visiting each
 * /m/view/{id} page individually (stage 2, scrape-details.mjs), because the
 * exact filename/URL isn't shown on the listing page.
 *
 * RUN ON A MACHINE WITH ACCESS TO movies.discoveryftp.net.
 *
 *   node scrape-listing.mjs                        # all categories, all pages
 *   node scrape-listing.mjs --categories English    # just one
 *   node scrape-listing.mjs --categories English --max-pages 5   # quick test
 *
 * Output: listing.json — {"36557": {title, year, quality, category}, ...}
 * Resumable: re-run any time; already-seen ids are skipped on re-crawl of
 * the same pages (harmless — cards get overwritten with the same data).
 */

import fs from 'node:fs/promises';

const BASE = 'https://movies.discoveryftp.net';
const ALL_CATEGORIES = ['English', 'Hindi', 'Bangla', 'Tamil', 'Animation', 'Others'];

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const CATEGORIES = (argVal('--categories', ALL_CATEGORIES.join(','))).split(',').map(s => s.trim());
const MAX_PAGES  = Number(argVal('--max-pages', Infinity));
const CONCURRENCY = Number(argVal('--concurrency', 6));
const TIMEOUT_MS = 20_000;

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function lastPageOf(html, category) {
  const re = new RegExp(`/m/category/${category}/(\\d+)">\\s*Last`);
  const m = html.match(re);
  return m ? Number(m[1]) : 1;
}

function parseCards(html, category) {
  const cardRe = /<a class="cfocus" href="\/m\/view\/(\d+)"><span class="movie_details_span_end">([^<]*)<\/span>.*?<h3 class="">([^<]*)<\/h3>.*?title="views">(\d{4})</gs;
  return [...html.matchAll(cardRe)].map(m => ({
    id: m[1],
    quality: m[2].trim(),
    title: m[3].trim().replace(/&#\d+;|&amp;/g, s => s === '&amp;' ? '&' : String.fromCharCode(s.slice(2, -1))),
    year: m[4],
    category,
  }));
}

async function loadListing() {
  try {
    return JSON.parse(await fs.readFile('listing.json', 'utf8'));
  } catch {
    return {};
  }
}

async function saveListing(obj) {
  await fs.writeFile('listing.json', JSON.stringify(obj));
}

const listing = await loadListing();
let totalNew = 0;

for (const category of CATEGORIES) {
  console.error(`\n== ${category}`);
  const firstUrl = `${BASE}/m/category/${category}`;
  const firstHtml = await fetchText(firstUrl);
  if (!firstHtml) { console.error('  failed to load first page, skipping category'); continue; }

  const lastPage = Math.min(lastPageOf(firstHtml, category), MAX_PAGES);
  console.error(`  ${lastPage} pages`);

  for (const c of parseCards(firstHtml, category)) { listing[c.id] = c; totalNew++; }

  let page = 2;
  while (page <= lastPage) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY && page <= lastPage; i++, page++) batch.push(page);

    await Promise.all(batch.map(async (p) => {
      const html = await fetchText(`${BASE}/m/category/${category}/${p}`);
      if (!html) { console.error(`  page ${p}: failed`); return; }
      for (const c of parseCards(html, category)) { listing[c.id] = c; totalNew++; }
    }));

    if (batch[batch.length - 1] % 20 < CONCURRENCY) {
      console.error(`  page ${batch[batch.length - 1]}/${lastPage} — ${Object.keys(listing).length} movies so far`);
      await saveListing(listing); // periodic checkpoint
    }
  }
}

await saveListing(listing);
console.error(`\nDone. listing.json has ${Object.keys(listing).length} movie entries.`);
console.error('Next: node scrape-details.mjs');
