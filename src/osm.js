// Street layout from OpenStreetMap (Overpass API): the things a local names when giving
// directions and TMAP's walking route doesn't have, like "the little rotary", "cross the big
// road" or "down the small street to Jongno". If no server answers, the route works without them.
import { distance, segmentDistance } from './geo.js';

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Study areas shipped with the app (public/osm/), so walks there never wait on public servers.
const BUNDLED = [{ file: 'osm/jongno.json', s: 37.5600, w: 126.9900, n: 37.5900, e: 127.0250 }];
const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const CACHE_KEY = 'local.osm';
const MARGIN = 0.0025; // ~250 m around the route, so re-plans nearby need no new download

// Big roads people know by name, even visitors.
export const BIG_ROADS = {
  '종로': 'Jongno', '을지로': 'Eulji-ro', '퇴계로': 'Toegye-ro', '율곡로': 'Yulgok-ro', '세종대로': 'Sejong-daero',
  '청계천로': 'Cheonggyecheon-ro', '대학로': 'Daehak-ro', '양화로': 'Yanghwa-ro', '와우산로': 'Wausan-ro', '홍익로': 'Hongik-ro',
  '테헤란로': 'Teheran-ro', '강남대로': 'Gangnam-daero', '한강대로': 'Hangang-daero', '이태원로': 'Itaewon-ro',
  '동호로': 'Dongho-ro', '다산로': 'Dasan-ro', '왕산로': 'Wangsan-ro', '난계로': 'Nangye-ro', '마장로': 'Majang-ro',
};

const BIG = /^(motorway|trunk|primary|secondary)$/;
const WALK_ONLY = /^(footway|path|steps|pedestrian|cycleway|corridor|platform|elevator)$/;

const memory = [];
function cached(box) {
  const inside = a => a.s <= box.s && a.w <= box.w && a.n >= box.n && a.e >= box.e;
  const hit = memory.find(inside);
  if (hit) return hit.ways;
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    const found = stored.find(inside);
    if (found) { memory.push(found); return found.ways; }
  } catch { /* storage blocked or full */ }
  return null;
}
function remember(area) {
  memory.push(area);
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]').slice(-3); // a few areas at most
    localStorage.setItem(CACHE_KEY, JSON.stringify([...stored, area]));
  } catch { /* storage blocked or full: memory only */ }
}

// All streets and paths around a route line, as [{ hw, name, en, ring, geom: [{lat,lng}] }].
export async function streetsAround(line, { timeoutMs = 7000 } = {}) {
  const lats = line.map(p => p.lat), lngs = line.map(p => p.lng);
  const want = { s: Math.min(...lats), w: Math.min(...lngs), n: Math.max(...lats), e: Math.max(...lngs) };
  const hit = cached(want);
  if (hit) return hit;
  const inside = a => a.s <= want.s - 0.0005 && a.w <= want.w - 0.0005 && a.n >= want.n + 0.0005 && a.e >= want.e + 0.0005;
  const bundled = BUNDLED.find(inside);
  if (bundled) {
    const res = await fetch(`${BASE}${bundled.file}`);
    if (res.ok) {
      const area = await res.json();
      memory.push(area); // too big for localStorage, and the page caches the file anyway
      return area.ways;
    }
  }
  const box = { s: want.s - MARGIN, w: want.w - MARGIN, n: want.n + MARGIN, e: want.e + MARGIN };
  const bbox = `${box.s.toFixed(5)},${box.w.toFixed(5)},${box.n.toFixed(5)},${box.e.toFixed(5)}`;
  const query = `[out:json][timeout:15];(way["highway"](${bbox});node["highway"="mini_roundabout"](${bbox}););out tags geom;`;
  // Public servers are often slow or down: ask them all at once and take the first answer.
  const ask = async url => {
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok || !text.trim().startsWith('{')) throw new Error(`${new URL(url).host}: ${res.status}`);
    return JSON.parse(text).elements.map(e => e.type === 'node'
      ? { hw: 'mini_roundabout', geom: [{ lat: e.lat, lng: e.lon }] }
      : {
        hw: e.tags.highway, name: e.tags.name, en: e.tags['name:en'],
        ring: /roundabout|circular/.test(e.tags.junction || ''),
        geom: e.geometry.map(g => ({ lat: +g.lat.toFixed(6), lng: +g.lon.toFixed(6) })),
      });
  };
  const ways = await Promise.any(SERVERS.map(ask)).catch(() => { throw new Error('no map server answered'); });
  remember({ ...box, ways });
  return ways;
}

// Small rotaries: mapped roundabouts, mini-roundabouts, or a little ring of link roads
// (how many small Seoul rotaries are drawn). Returns their centres.
export function rotaries(ways) {
  const out = [];
  for (const w of ways) {
    if (w.hw === 'mini_roundabout') out.push({ ...w.geom[0], size: 10 });
    else if (w.ring && extent(w.geom) < 120) out.push({ ...centre(w.geom), size: extent(w.geom) });
  }
  // Rings of *_link ways (each link joins two end points): strip links that lead nowhere until
  // only closed loops are left, then keep the loops small enough to be a rotary, not a ramp system.
  const key = p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  let edges = ways.filter(w => /_link$/.test(w.hw || '')).map(w => ({ a: key(w.geom[0]), b: key(w.geom.at(-1)), w }));
  for (const e of edges) if (e.a === e.b && extent(e.w.geom) < 70) out.push({ ...centre(e.w.geom), size: extent(e.w.geom) }); // a loop drawn as one way
  edges = edges.filter(e => e.a !== e.b);
  for (let changed = true; changed;) {
    const degree = new Map();
    for (const e of edges) for (const k of [e.a, e.b]) degree.set(k, (degree.get(k) || 0) + 1);
    const kept = edges.filter(e => degree.get(e.a) > 1 && degree.get(e.b) > 1);
    changed = kept.length < edges.length;
    edges = kept;
  }
  // What remains are loops; group the links of each loop by shared end points.
  const groups = [];
  for (const e of edges) {
    const touching = groups.filter(g => g.keys.has(e.a) || g.keys.has(e.b));
    const merged = { keys: new Set([e.a, e.b]), pts: [...e.w.geom] };
    for (const g of touching) { g.keys.forEach(k => merged.keys.add(k)); merged.pts.push(...g.pts); groups.splice(groups.indexOf(g), 1); }
    groups.push(merged);
  }
  for (const g of groups) if (extent(g.pts) < 70) out.push({ ...centre(g.pts), size: extent(g.pts) });
  // A roundabout drawn in several pieces gives several centres: merge those that are close.
  const merged = [];
  for (const r of out) {
    const same = merged.find(m => distance(m, r) < 50);
    if (same) { same.size = Math.max(same.size, r.size, distance(same, r) * 2); } else merged.push({ ...r });
  }
  return merged;
}

const centre = pts => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length });
function extent(pts) {
  let max = 0;
  for (const a of pts) for (const b of pts) max = Math.max(max, distance(a, b));
  return max;
}

// The street nearest to a point (not footpaths), within `within` metres.
function streetAt(ways, p, within = 20) {
  let best = null, bestD = within;
  for (const w of ways) {
    if (!w.hw || WALK_ONLY.test(w.hw) || w.hw === 'mini_roundabout' || /crossing/.test(w.hw)) continue;
    for (let i = 1; i < w.geom.length; i++) {
      const d = segmentDistance(p, w.geom[i - 1], w.geom[i]);
      if (d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

// Where someone stands on the street in front of place `p`, and the street's direction there.
// With the side they said the place is on, that gives the way they face.
export function frontOf(ways, p, sideOfPlace) {
  let best = null;
  for (const w of ways) {
    if (!w.hw || WALK_ONLY.test(w.hw) || w.hw === 'mini_roundabout' || /_link$/.test(w.hw)) continue;
    for (let i = 1; i < w.geom.length; i++) {
      const d = segmentDistance(p, w.geom[i - 1], w.geom[i]);
      if (!best || d < best.d) best = { d, a: w.geom[i - 1], b: w.geom[i] };
    }
  }
  if (!best || best.d > 50) return null;
  // The foot of the perpendicular from p onto the segment (flat-earth, fine at street scale).
  const k = Math.cos(p.lat * Math.PI / 180);
  const ax = best.a.lng * k, ay = best.a.lat, bx = best.b.lng * k, by = best.b.lat, px = p.lng * k, py = p.lat;
  const len = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len)) : 0;
  const foot = { lat: ay + t * (by - ay), lng: (ax + t * (bx - ax)) / k };
  // They walk on the pavement on the place's side, not on the street's centre line: step from
  // the centre line towards the place (up to 10 m, about half a big road).
  const f = best.d > 1 ? Math.min(best.d * 0.6, 10) / best.d : 0;
  const point = { lat: foot.lat + (p.lat - foot.lat) * f, lng: foot.lng + (p.lng - foot.lng) * f };
  let facing = null;
  if (sideOfPlace === 'left' || sideOfPlace === 'right') {
    const along = bearingOf(best.a, best.b);
    // Is the place to the left of someone walking from a to b?
    const leftOfAB = (bx - ax) * (py - ay) - (by - ay) * (px - ax) > 0;
    facing = (sideOfPlace === 'left') === leftOfAB ? along : (along + 180) % 360;
  }
  return { point, facing, d: best.d };
}

function bearingOf(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// The street with this name nearest to a point (to learn its size).
function nearestNamed(ways, p, name) {
  let best = null, bestD = 60;
  for (const w of ways) {
    if (w.name !== name) continue;
    for (let i = 1; i < w.geom.length; i++) {
      const d = segmentDistance(p, w.geom[i - 1], w.geom[i]);
      if (d < bestD) { bestD = d; best = w; }
    }
  }
  return best;
}

// How a local would call a street: big roads by their known name, others by their size.
export function streetName(w) {
  if (!w) return null;
  const known = BIG_ROADS[w.name] || (BIG.test(w.hw) ? w.en : null);
  const size = BIG.test(w.hw) ? 'a big road' : w.hw === 'tertiary' || w.hw === 'tertiary_link' ? 'a normal street'
    : /^(residential|unclassified|living_street|service)$/.test(w.hw) ? 'a small side street' : 'a street';
  return { size, name: known || null, big: BIG.test(w.hw) };
}

// The point `m` metres along a line from its start.
function along(line, m) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = distance(line[i - 1], line[i]);
    if (acc + d >= m) {
      const f = d ? (m - acc) / d : 0;
      return { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * f, lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * f };
    }
    acc += d;
  }
  return line.at(-1);
}

// What a local would mention at each decision point and along each stretch.
// `cuts[i]` is how far along the route line decision i is (metres).
export function routeFeatures(ways, route, cuts) {
  const rings = rotaries(ways);
  return route.decisions.map((t, i) => {
    const f = {};
    const ring = rings.find(r => distance(r, t) < 25 + r.size / 2);
    if (ring) f.rotary = ring.size < 45 ? 'a small rotary (a little roundabout)' : 'a rotary (roundabout)';
    const leg = t.leg || {};
    // The street crossed at a crosswalk: the one nearest the middle of the crossing.
    if (t.action.startsWith('crosswalk')) {
      const crossLen = Math.max(8, Math.min(40, leg.crossLength || 20));
      const mid = along(route.line, cuts[i] + crossLen / 2);
      f.crosses = streetName(streetAt(ways, mid, 25));
    }
    // The street they walk along after the turn. TMAP names the road of each bit of the walk;
    // the one they walk along longest says it best (on a big road's pavement, the nearest
    // street line can be a side street, since the big road's centre line is far away).
    if (leg.distance > 30) {
      const [main, len] = Object.entries(leg.roadLength || {}).sort((a, b) => b[1] - a[1])[0] || [];
      const start = cuts[i] + (t.action.startsWith('crosswalk') ? Math.min(40, leg.crossLength || 20) : 0);
      const mid = along(route.line, start + (leg.distance - (start - cuts[i])) / 2);
      if (main && len >= leg.distance / 2) {
        const named = BIG_ROADS[main] ? { hw: 'primary', name: main } : nearestNamed(ways, mid, main);
        f.along = streetName(named || streetAt(ways, mid, 15));
      } else {
        f.along = streetName(streetAt(ways, mid, 15));
      }
    }
    return f;
  });
}

