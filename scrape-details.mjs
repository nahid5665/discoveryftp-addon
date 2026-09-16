#!/usr/bin/env node
/**
 * scrape-details.mjs — Stage 2: for each id in listing.json, fetch
 * /m/view/{id} and extract the direct playable file URL + genres.
 *
 * Resumable: writes index.json incrementally, skips ids already present.
 * Safe to Ctrl+C and re-run.
 *
 *   node scrape-details.mjs                # all remaining ids
 *   node scrape-details.mjs --limit 200     # quick test run
 */

import fs from 'node:fs/promises';

const BASE = 'https://movies.discoveryftp.net';
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const CONCURRENCY = Number(argVal('--concurrency', 6));
const LIMIT       = Number(argVal('--limit', Infinity));
const TIMEOUT_MS  = 20_000;

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

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
}

function parseDetail(html) {
  const dl = html.match(/<a title="\s*([^"]+\.(?:mkv|mp4))"\s*href="\s*(https?:\/\/[^"]+)"/);
  const genres = [...html.matchAll(/\/m\/genre\/([^"']+)"/g)].map(m => m[1]);
  return {
    filename: dl ? decodeEntities(dl[1].trim()) : null,
    url: dl ? dl[2].trim() : null,
    genres,
  };
}

async function loadJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return fallback; }
}

const listing = await loadJSON('listing.json', null);
if (!listing) { console.error('listing.json not found — run scrape-listing.mjs first.'); process.exit(1); }

const index = await loadJSON('index-raw.json', {});
const pending = Object.keys(listing).filter(id => !index[id]).slice(0, LIMIT);

console.error(`${Object.keys(listing).length} total, ${Object.keys(index).length} already done, ${pending.length} to fetch.`);

let done = 0;
for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (id) => {
    const html = await fetchText(`${BASE}/m/view/${id}`);
    if (!html) return;
    const { filename, url, genres } = parseDetail(html);
    if (!url) return; // page didn't have a direct download link (rare — skip)
    index[id] = { ...listing[id], filename, url, genres };
  }));

  done += batch.length;
  if (done % 60 < CONCURRENCY) {
    console.error(`  ${done}/${pending.length}`);
    await fs.writeFile('index-raw.json', JSON.stringify(index)); // checkpoint
  }
}

await fs.writeFile('index-raw.json', JSON.stringify(index));

// Emit the final shape api/index.mjs expects.
const items = Object.entries(index)
  .filter(([, v]) => v.url)
  .map(([id, v]) => ({
    id, n: v.filename, u: v.url, t: v.title, y: Number(v.year) || null,
    q: v.quality, c: v.category, g: v.genres || [],
  }));

await fs.writeFile('index.json', JSON.stringify({ generated: new Date().toISOString(), count: items.length, items }));

console.error(`\nDone. index.json has ${items.length} playable entries.`);
