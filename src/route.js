// A walking route with everything the guide talks about: TMAP's route, the landmarks at each
// turn, the shops along each stretch, and the street layout from OpenStreetMap (rotaries, big
// roads). Kept apart from the page so the rehearsal scripts build routes with exactly this code.
import { walkingRoute } from './tmap.js';
import { placesNear, LANDMARK_TYPES } from './kakao.js';
import { streetsAround, routeFeatures } from './osm.js';
import { side, distance, lineDistance, project, pointsAlong } from './geo.js';

// Places people notice from the pavement, looked up every ~60 m along the whole route.
const ALONG_TYPES = ['CE7', 'CS2', 'FD6', 'PM9', 'BK9', 'SW8', 'MT1', 'HP8', 'AD5', 'CT1', 'AT4', 'PO3', 'SC4', 'OL7'];

// Run async tasks with at most `n` at a time (Kakao limits how fast we may ask).
async function pool(tasks, n) {
  const it = tasks[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => { for (const task of it) await task(); }));
}

async function shopsAlong(route) {
  const found = new Map();
  await pool(pointsAlong(route.line, 60).flatMap(pt => ALONG_TYPES.map(code => async () => {
    for (const p of await placesNear(pt, 35, [code], 15)) if (!found.has(p.name)) found.set(p.name, p);
  })), 6);
  return [...found.values()]
    .map(p => ({ ...p, ...project(route.line, p) }))
    .filter(p => p.off < 30)
    .sort((a, b) => a.s - b.s);
}

// Hand each stretch the shops that lie along it.
function assignShops(route, shops) {
  const cuts = route.cuts;
  const between = (from, to) => shops.filter(p => p.s >= from && p.s < to).map(p => ({ ...p, after_m: Math.round(p.s - from) }));
  if (route.startLeg) route.startLeg.shops = between(0, cuts[0] ?? Infinity);
  route.decisions.forEach((t, i) => { if (t.leg) t.leg.shops = between(cuts[i], cuts[i + 1] ?? Infinity); });
  route.shopsReady = true;
}

// `quick`: return as soon as the turns and the street layout are known, and add the shops along
// the way in the background (route.more resolves when they are in). Used when re-planning
// mid-walk, where the walker is waiting for the next direction.
export async function buildRoute(from, to, { personal = [], likes = [], via = [], quick = false } = {}) {
  const t0 = Date.now();
  const route = await walkingRoute(from, to, via);
  route.id = `${Date.now().toString(36)}`;
  route.dest = to;
  route.likes = likes;
  route.personal = personal.filter(m => lineDistance(m, route.line) < 50);
  route.cuts = route.decisions.map(t => project(route.line, t).s);
  const d = project(route.line, to);
  route.destSide = d.off > 4 ? d.side : null; // which side of the street the destination is on

  const landmarks = Promise.all(route.decisions.map(async turn => {
    const found = await placesNear(turn, 30, LANDMARK_TYPES, 3);
    turn.landmarks = found.map(p => ({
      ...p,
      side: turn.heading != null ? side(turn.approach, turn.heading, p) : undefined,
      distance: distance(turn, p),
    }));
    turn.personal = route.personal.filter(m => distance(turn, m) < 40)
      .map(m => ({ ...m, side: turn.heading != null ? side(turn.approach, turn.heading, m) : undefined }));
  }));
  const streets = streetsAround(route.line)
    .then(ways => { route.features = routeFeatures(ways, route, route.cuts); })
    .catch(err => { route.streetsError = err.message; });
  route.shopsReady = false;
  route.more = shopsAlong(route).then(shops => assignShops(route, shops)).catch(err => { route.shopsError = err.message; });

  // Mid-walk, don't keep the walker waiting on the street layout: it fills in when it arrives.
  const streetsSoon = quick ? Promise.race([streets, new Promise(r => setTimeout(r, 1500))]) : streets;
  await Promise.all([landmarks, streetsSoon, quick ? null : route.more]);
  route.buildMs = Date.now() - t0;
  return route;
}
