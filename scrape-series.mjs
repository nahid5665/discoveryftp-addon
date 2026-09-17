#!/usr/bin/env node
/**
 * scrape-series.mjs — crawls DiscoveryFTP series.
 *
 * Unlike movies, series don't need a separate listing stage: show ids are
 * small sequential numbers (id 1 through ~7000ish), so we just sweep them
 * directly at /s/view/{id}. Each show page also lists all its seasons
 * (/s/view/{id}/{season}), and each season page has every episode's direct
 * play link right there in the HTML — no further stage needed.
 *
 *   node scrape-series.mjs                      # sweep 1..8000 (safe default)
 *   node scrape-series.mjs --start 1 --end 500   # smaller test run
 *
 * Output: index-series.json — flat list of episodes, one entry per episode.
 * Resumable: checkpoints every ~40 shows, skips ids already done.
 */

import fs from 'node:fs/promises';

const BASE = 'https://movies.discoveryftp.net';
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const START = Number(argVal('--start', 1));
const END   = Number(argVal('--end', 8000));
const REFRESH = Number(argVal('--refresh', 0));
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

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
}

function parseShowPage(html) {
  const title = (html.match(/<h3>\s*([\s\S]*?)\s*<\/h3>/) || [])[1]?.trim();
  if (!title) return null; // id doesn't exist / empty page

  const genreBlock = html.match(/class="ganre-wrapper">([\s\S]*?)<\/div>/);
  const genres = genreBlock ? [...genreBlock[1].matchAll(/\/s\/genre\/([^"']+)"/g)].map(m => decodeEntities(m[1])) : [];

  const seasons = [...new Set(
    [...html.matchAll(/href="\/s\/view\/\d+\/(\d+)">\|\s*Season/g)].map(m => m[1])
  )];

  const epRe = /<h5>S(\d+)\s*\|\s*EP (\d+)\s*<a href="([^"]+)">[\s\S]*?<h4>([^<]+?)\s*<br>[\s\S]*?badge-outline mt-2">\s*([^<]*)<\/div>[\s\S]*?<p style="color:lightseagreen">([^<]*)<\/p>/g;
  const episodes = [...html.matchAll(epRe)].map(m => ({
    season: Number(m[1]),
    episode: Number(m[2]),
    url: m[3].trim(),
    epTitle: decodeEntities(m[4].trim()),
    quality: m[5].trim(),
    overview: decodeEntities(m[6].trim()),
  }));

  return { title: decodeEntities(title), genres, seasons, episodes };
}

async function loadJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return fallback; }
}

// done.json tracks which show ids we've fully processed (all seasons), so
// re-running only touches ids we haven't seen yet.
const done = await loadJSON('series-done.json', {});
const episodesByShow = await loadJSON('series-episodes.json', {});

// --refresh N: shows near the top of the id range are the ones most likely
// to have gained a new episode since last run (airing shows update weekly).
// Clearing their "done" status makes the sweep below re-fetch them.
if (REFRESH > 0) {
  const doneIds = Object.keys(done).map(Number).sort((a, b) => b - a);
  for (const id of doneIds.slice(0, REFRESH)) delete done[id];
  console.error(`Refreshing the ${Math.min(REFRESH, doneIds.length)} most recent shows for new episodes.`);
}

const ids = [];
for (let id = START; id <= END; id++) if (!done[id]) ids.push(id);
console.error(`${END - START + 1} ids in range, ${Object.keys(done).length} already done, ${ids.length} to check.`);

let checked = 0;
let found = 0;

for (let i = 0; i < ids.length; i += CONCURRENCY) {
  const batch = ids.slice(i, i + CONCURRENCY);

  await Promise.all(batch.map(async (id) => {
    const html = await fetchText(`${BASE}/s/view/${id}`);
    if (!html) { done[id] = 'fetch-failed'; return; }

    const base = parseShowPage(html);
    if (!base) { done[id] = 'empty'; return; } // no show at this id

    found++;
    const allEpisodes = [...base.episodes.map(e => ({ ...e, show: base.title, genres: base.genres, showId: id }))];

    // Fetch every OTHER season not already shown on the base page.
    const baseSeasons = new Set(base.episodes.map(e => String(e.season).padStart(2, '0')));
    const otherSeasons = base.seasons.filter(s => !baseSeasons.has(s));

    for (const s of otherSeasons) {
      const sHtml = await fetchText(`${BASE}/s/view/${id}/${s}`);
      if (!sHtml) continue;
      const sPage = parseShowPage(sHtml);
      if (!sPage) continue;
      allEpisodes.push(...sPage.episodes.map(e => ({ ...e, show: base.title, genres: base.genres, showId: id })));
    }

    episodesByShow[id] = allEpisodes;
    done[id] = 'ok';
  }));

  checked += batch.length;
  if (checked % 40 < CONCURRENCY) {
    console.error(`  ${checked}/${ids.length} checked, ${found} shows found so far`);
    await fs.writeFile('series-done.json', JSON.stringify(done));
    await fs.writeFile('series-episodes.json', JSON.stringify(episodesByShow));
  }
}

await fs.writeFile('series-done.json', JSON.stringify(done));
await fs.writeFile('series-episodes.json', JSON.stringify(episodesByShow));

// Emit the final flat shape api/index.mjs expects for series.
const items = [];
for (const [showId, episodes] of Object.entries(episodesByShow)) {
  for (const e of episodes) {
    items.push({
      showId, show: e.show, season: e.season, episode: e.episode,
      epTitle: e.epTitle, u: e.url, q: e.quality, g: e.genres || [],
    });
  }
}

await fs.writeFile('index-series.json', JSON.stringify({ generated: new Date().toISOString(), count: items.length, items }));
console.error(`\nDone. index-series.json has ${items.length} episodes across ${Object.keys(episodesByShow).length} shows.`);
