// Checkpoints: each turn of the route (and the destination) as something to recognise, a short
// line saying what to do there, the landmark to look for, and where to look from and at, for the
// street view picture.
import { distance, destinationPoint } from './geo.js';
import { BIG_ROADS } from './osm.js';

const DO = {
  left: 'Turn left', right: 'Turn right', straight: 'Keep straight', 'U-turn': 'Turn around',
  'slight left': 'Bear left', 'slight right': 'Bear right', 'sharp left': 'Sharp left', 'sharp right': 'Sharp right',
  crosswalk: 'Cross straight ahead', 'crosswalk, then left': 'Left across the crosswalk', 'crosswalk, then right': 'Right across the crosswalk',
  "crosswalk (2 o'clock)": 'Bear right across the crosswalk', "crosswalk (10 o'clock)": 'Bear left across the crosswalk',
  "crosswalk (4 o'clock)": 'Sharp right across the crosswalk', "crosswalk (8 o'clock)": 'Sharp left across the crosswalk',
  stairs: 'Take the stairs', overpass: 'Take the footbridge', underpass: 'Take the underpass',
};

// Chains people recognise by their sign: shown as a coloured badge (name on the brand colour).
export const BRAND_COLORS = {
  '7-Eleven': ['#00704a', '#fff'], GS25: ['#0080c6', '#fff'], CU: ['#652d90', '#bfd730'], emart24: ['#ffb81c', '#333'],
  Ministop: ['#003f7d', '#fff'], Starbucks: ['#00704a', '#fff'], "McDonald's": ['#da291c', '#ffc72c'], 'Burger King': ['#d62300', '#f5ebdc'],
  KFC: ['#a3080c', '#fff'], Lotteria: ['#e60012', '#fff'], "Mom's Touch": ['#e4002b', '#fff'], 'Paris Baguette': ['#004a98', '#fff'],
  'Tous les Jours': ['#00754a', '#fff'], 'Olive Young': ['#9acd32', '#1a3300'], Daiso: ['#e60012', '#fff'], "Paik's Coffee": ['#ffd200', '#0b3a7e'],
  'Mega Coffee': ['#ffd400', '#47210c'], 'Ediya Coffee': ['#1b3a6b', '#fff'], 'Compose Coffee': ['#ffcd00', '#222'], 'A Twosome Place': ['#ee2e24', '#fff'],
  Subway: ['#008c15', '#ffc600'], 'Baskin Robbins': ['#ff1d8e', '#fff'], "Dunkin'": ['#ff671f', '#fff'], 'Hollys Coffee': ['#a6192e', '#fff'],
};

const lookAhead = (t, m = 20) => (t.outHeading != null ? destinationPoint(t, t.outHeading, m) : t);

// The point `m` metres along the route line (to see a turn the way they'll approach it).
function along(line, m) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = distance(line[i - 1], line[i]);
    if (acc + d >= m) { const f = d ? (m - acc) / d : 0; return { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * f, lng: line[i - 1].lng + (line[i].lng - line[i - 1].lng) * f }; }
    acc += d;
  }
  return line.at(-1);
}
const lineLength = line => line.reduce((sum, p, i) => sum + (i ? distance(line[i - 1], p) : 0), 0);

export function checkpointsOf(route) {
  const list = route.decisions.map((t, i) => {
    const f = route.features?.[i] || {};
    const mine = t.personal?.[0];
    const mark = t.landmarks?.find(l => l.distance < 30);
    const atStart = i === 0 && (route.startLeg?.distance ?? 99) < 15;
    const prevLeg = i === 0 ? route.startLeg : route.decisions[i - 1].leg;
    const big = prevLeg?.reaches && BIG_ROADS[prevLeg.reaches];
    const where = mine ? `by your ${mine.label.replace(/^the /, '')}`
      : f.rotary ? 'at the little rotary'
        : mark ? `by ${mark.en || `${mark.name} (${mark.type})`}` // on screen the sign's own name helps
          : big ? `at ${big}` : '';
    const action = atStart && t.action.startsWith('crosswalk') ? 'Cross at the crosswalk right by you' : DO[t.action] || t.action;
    // Seen as they come up to it: from about 35 m before the turn on their way, looking at what
    // marks it. The crosswalk right at the start: looking across the road.
    const target = atStart ? lookAhead(t, 20) : mine || mark || f.rotaryAt || t;
    const from = atStart ? t : along(route.line, Math.max(0, (route.cuts?.[i] ?? 0) - 35));
    return {
      n: i + 1,
      title: action,
      sub: where,
      brand: mark?.en && BRAND_COLORS[mark.en] ? mark.en : null,
      from,
      look: distance(from, target) < 5 ? lookAhead(t) : target,
      photoOf: mine?.photo ? mine : null,
    };
  });
  list.push({
    n: list.length + 1,
    title: `${route.dest.name} is here`,
    sub: route.destSide ? `on your ${route.destSide}` : '',
    brand: null,
    from: along(route.line, Math.max(0, lineLength(route.line) - 25)), // the last bit of street before it
    look: route.dest,
    arrival: true,
  });
  return list;
}
