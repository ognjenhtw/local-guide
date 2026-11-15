// Picking where to go: the places matching what the walker asked for, each described the way a
// local would tell them apart without a map: how long a walk, the subway station it's near,
// the shop right next to it, and the first turns of the way there.
import { findNear, placesNear, LANDMARK_TYPES } from './kakao.js';
import { walkingRoute } from './tmap.js';
import { placeText } from './guide.js';
import { BIG_ROADS } from './osm.js';
import { distance, bearing, compass } from './geo.js';

const TURN_WORDS = {
  left: 'left', right: 'right', 'slight left': 'bear left', 'slight right': 'bear right', 'sharp left': 'sharp left', 'sharp right': 'sharp right',
  crosswalk: 'cross straight ahead', 'crosswalk, then left': 'left across a crosswalk', 'crosswalk, then right': 'right across a crosswalk',
};

// The first couple of turns of the way there, with what's at each.
async function wayThere(route) {
  const turns = route.decisions.slice(0, 2);
  const marks = await Promise.all(turns.map(t => placesNear(t, 25, LANDMARK_TYPES, 1).catch(() => [])));
  return turns.map((t, i) => {
    const mark = marks[i][0];
    const road = BIG_ROADS[route.decisions[i - 1]?.leg?.reaches || route.startLeg?.reaches];
    return `${TURN_WORDS[t.action] || t.action}${road ? ` at ${road}` : ''}${mark ? ` by ${placeText(mark)}` : ''}`;
  }).join(', then ');
}

// Up to 8 matches, nearest first. The nearest `detailed` get a walking route worked out.
export async function destinationOptions(from, query, { detailed = 3 } = {}) {
  let found = await findNear(from, [query], 3000, 8);
  if (!found.length) found = await findNear(from, [query], 20000, 8);
  const options = found.map((p, i) => ({ ...p, n: i + 1 }));
  await Promise.all(options.map(async o => {
    const [stations, around] = await Promise.all([
      placesNear(o, 700, ['SW8'], 1).catch(() => []),
      placesNear(o, 30, LANDMARK_TYPES, 4).catch(() => []),
    ]);
    o.station = stations[0] ? { name: stations[0].name, m: Math.round(distance(o, stations[0])) } : null;
    o.nextTo = around.filter(a => a.name !== o.name).slice(0, 2);
    o.direction = compass(bearing(from, o));
  }));
  await Promise.all(options.slice(0, detailed).map(async o => {
    try {
      const r = await walkingRoute(from, o);
      o.minutes = Math.max(1, Math.round(r.time / 60));
      o.way = await wayThere(r);
    } catch { /* described without the way there */ }
  }));
  return options;
}

// One option as the guide's brain reads it.
export function optionText(o) {
  return [
    `#${o.n}: ${placeText(o)}`,
    o.minutes ? `${o.minutes} min walk` : `${Math.round(o.distance)} m away in a straight line`,
    `to the ${o.direction}`,
    o.station ? `near ${o.station.name} (subway, ${o.station.m} m)` : null,
    o.nextTo?.length ? `right next to ${o.nextTo.map(placeText).join(' and ')}` : null,
    o.way ? `the way there: ${o.way}` : null,
  ].filter(Boolean).join('; ');
}
