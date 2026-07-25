// Nuvio / Stremio-addon content browser.
//
// Nuvio is powered by the Stremio addon protocol: plain JSON over HTTPS
// with CORS enabled (the protocol requires it — Stremio Web depends on it).
// That means the theater can talk to the same sources Nuvio itself uses,
// natively, without embedding a web page (no browser can texture a
// cross-origin page into WebGL — that's a platform rule, not a choice).
//
//   catalog search:  {cinemeta}/catalog/{type}/top/search={q}.json
//   series meta:     {cinemeta}/meta/series/{id}.json
//   streams:         {addon}/stream/{type}/{id}.json   → { streams: [...] }
//
// Stream addons are user-configurable; any Nuvio Streams deployment or
// other HTTP-stream Stremio addon URL works. Results that fail CORS for
// WebGL are reported so the next stream can be tried.

const CINEMETA = 'https://v3-cinemeta.strem.io';
const DEFAULT_ADDONS = [
  'https://nuviostreams.hayd.uk',
];

const LS_KEY = 'vrtheater.addons';

export function getAddons() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(v) && v.length) return v;
  } catch (e) { /* fall through */ }
  return [...DEFAULT_ADDONS];
}

export function setAddons(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list.filter(Boolean)));
}

async function getJson(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function search(query) {
  const q = encodeURIComponent(query.trim());
  const [movies, series] = await Promise.allSettled([
    getJson(`${CINEMETA}/catalog/movie/top/search=${q}.json`),
    getJson(`${CINEMETA}/catalog/series/top/search=${q}.json`),
  ]);
  const metas = [];
  if (movies.status === 'fulfilled') {
    for (const m of movies.value.metas || []) metas.push({ ...m, type: 'movie' });
  }
  if (series.status === 'fulfilled') {
    for (const m of series.value.metas || []) metas.push({ ...m, type: 'series' });
  }
  return metas.slice(0, 24);
}

export async function episodes(seriesId) {
  const data = await getJson(`${CINEMETA}/meta/series/${seriesId}.json`);
  const vids = (data.meta && data.meta.videos) || [];
  const seasons = new Map();
  for (const v of vids) {
    if (v.season === 0) continue; // skip specials by default
    if (!seasons.has(v.season)) seasons.set(v.season, []);
    seasons.get(v.season).push(v);
  }
  for (const list of seasons.values()) list.sort((a, b) => a.episode - b.episode);
  return seasons;
}

function qualityRank(s) {
  const text = `${s.name || ''} ${s.title || ''} ${s.description || ''}`;
  if (/2160|4k/i.test(text)) return 0;
  if (/1080/i.test(text)) return 1;
  if (/720/i.test(text)) return 2;
  return 3;
}

// id: "tt123" for movies, "tt123:1:2" for series episodes
export async function streams(type, id, onPartial) {
  const bases = getAddons();
  const all = [];
  const results = await Promise.allSettled(bases.map(async (base) => {
    const b = base.replace(/\/+$/, '').replace(/\/manifest\.json$/, '');
    const data = await getJson(`${b}/stream/${type}/${encodeURIComponent(id)}.json`, 25000);
    const found = (data.streams || [])
      .filter(s => s.url && /^https?:/i.test(s.url))
      .map(s => ({ ...s, addon: new URL(b).hostname }));
    all.push(...found);
    if (onPartial) onPartial(sortStreams(all));
    return found.length;
  }));
  const errors = results
    .map((r, i) => r.status === 'rejected' ? `${new URL(bases[i]).hostname}: ${r.reason.message}` : null)
    .filter(Boolean);
  return { streams: sortStreams(all), errors };
}

function sortStreams(list) {
  return [...list].sort((a, b) => qualityRank(a) - qualityRank(b));
}

export function streamLabel(s) {
  const bits = [s.name, s.title || s.description].filter(Boolean).join(' — ');
  return bits.replace(/\n+/g, ' · ').slice(0, 110) || s.url.slice(0, 80);
}
