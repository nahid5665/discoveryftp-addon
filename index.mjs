/**
 * Stremio addon for DiscoveryFTP (DFLIX) — stream-only, backed by index.json
 * from scrape-listing.mjs + scrape-details.mjs.
 *
 * Because the site's own catalog already gives clean titles/years, matching
 * against Cinemeta is exact (normalised) comparison — no filename guessing.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));

// Series index is optional — addon still works movie-only if it's missing.
let rawSeries = { generated: null, count: 0, items: [] };
try {
  rawSeries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index-series.json'), 'utf8'));
} catch { /* not built yet */ }

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ITEMS = raw.items.map(it => ({ ...it, tn: norm(it.t) }));
const EPISODES = rawSeries.items.map(it => ({ ...it, tn: norm(it.show) }));

const MANIFEST = {
  id: 'com.you.discoveryftp.streams',
  version: '1.1.0',
  name: 'DiscoveryFTP (Local)',
  description: `Direct BDIX streams from DiscoveryFTP/DFLIX. Movies: ${raw.count}. Series episodes: ${rawSeries.count}.`,
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
};

const metaCache = new Map();
async function cinemeta(type, imdbId) {
  const key = `${type}:${imdbId}`;
  if (metaCache.has(key)) return metaCache.get(key);
  try {
    const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
    if (!res.ok) return null;
    const { meta } = await res.json();
    const out = { name: meta?.name, year: parseInt(String(meta?.year || '').slice(0, 4), 10) || null };
    metaCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

const QORDER = ['4k uhd', '4k web-dl', '4k hevc', '2160p', '1080p web-dl', '1080p-br', '1080p', '720p hdrip', '720p', 'cam-rip'];
function qrank(q) {
  const ql = q.toLowerCase();
  const i = QORDER.findIndex(k => ql.includes(k));
  return i === -1 ? QORDER.length : i;
}

function findMovie(title, year) {
  const t = norm(title);
  return ITEMS.filter(it => {
    if (it.tn !== t) return false;
    if (!year || !it.y) return true;
    return Math.abs(it.y - year) <= 1;
  });
}

function findEpisode(showTitle, season, episode) {
  const t = norm(showTitle);
  return EPISODES.filter(e => e.tn === t && e.season === season && e.episode === episode);
}

function toStreams(matches) {
  return matches
    .slice()
    .sort((a, b) => qrank(a.q) - qrank(b.q))
    .slice(0, 20)
    .map(it => ({
      name: `DFLIX\n${it.q.trim() || 'SD'}`,
      title: [it.n, it.g?.length ? it.g.join(', ') : null, `📁 ${it.c}`].filter(Boolean).join('\n'),
      url: it.u,
      behaviorHints: { notWebReady: true, bingeGroup: `discoveryftp-${qrank(it.q)}` },
    }));
}

function toEpisodeStreams(matches) {
  return matches
    .slice()
    .sort((a, b) => qrank(a.q) - qrank(b.q))
    .slice(0, 20)
    .map(e => ({
      name: `DFLIX\n${e.q.trim() || 'SD'}`,
      title: [e.epTitle, e.g?.length ? e.g.join(', ') : null].filter(Boolean).join('\n'),
      url: e.u,
      behaviorHints: { notWebReady: true, bingeGroup: `discoveryftp-s-${qrank(e.q)}` },
    }));
}

async function route(pathname) {
  if (pathname === '/' || pathname === '/manifest.json') return MANIFEST;

  const movieMatch = pathname.match(/^\/stream\/movie\/(.+)\.json$/);
  if (movieMatch) {
    const imdbId = decodeURIComponent(movieMatch[1]);
    const meta = await cinemeta('movie', imdbId);
    if (!meta?.name) return { streams: [] };
    return { streams: toStreams(findMovie(meta.name, meta.year)) };
  }

  // Stremio series stream ids look like "tt1234567:1:3" (imdbId:season:episode).
  const seriesMatch = pathname.match(/^\/stream\/series\/(.+)\.json$/);
  if (seriesMatch) {
    const [imdbId, seasonStr, episodeStr] = decodeURIComponent(seriesMatch[1]).split(':');
    const season = Number(seasonStr), episode = Number(episodeStr);
    const meta = await cinemeta('series', imdbId);
    if (!meta?.name || !season || !episode) return { streams: [] };
    return { streams: toEpisodeStreams(findEpisode(meta.name, season, episode)) };
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600');

  const url  = new URL(req.url, 'http://x');
  const body = await route(url.pathname);

  if (!body) { res.statusCode = 404; res.end(JSON.stringify({ err: 'not found' })); return; }
  res.end(JSON.stringify(body));
}

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  const port = process.env.PORT || 7001;
  http.createServer((req, res) => handler(req, res)).listen(port, '0.0.0.0', () => {
    console.log(`Addon on http://127.0.0.1:${port}/manifest.json  (${raw.count} files indexed)`);
  });
}
