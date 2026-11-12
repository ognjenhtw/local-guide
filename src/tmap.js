// TMAP pedestrian route API (SK Open API). Called directly from the browser.
import { distance, bearing } from './geo.js';

const KEY = import.meta.env.VITE_TMAP_APP_KEY;

const TURNS = {
  11: 'straight', 12: 'left', 13: 'right', 14: 'U-turn',
  16: 'sharp left', 17: 'slight left', 18: 'slight right', 19: 'sharp right',
  125: 'overpass', 126: 'underpass', 127: 'stairs', 128: 'ramp', 129: 'stairs and ramp',
  200: 'start', 201: 'arrive',
  211: 'crosswalk', 212: 'crosswalk, then left', 213: 'crosswalk, then right',
  214: 'crosswalk (8 o\'clock)', 215: 'crosswalk (10 o\'clock)',
  216: 'crosswalk (2 o\'clock)', 217: 'crosswalk (4 o\'clock)',
  218: 'elevator', 233: 'straight',
};

// A decision point is anywhere the walker must do something other than keep going.
const isDecision = t => t !== 11 && t !== 200 && t !== 201 && t !== 233 && TURNS[t] !== undefined;
// TMAP names footpaths generically ("pedestrian road"); those aren't street names worth saying.
const GENERIC_ROADS = ['보행자도로', '보도', '이면도로'];

// `via`: up to 5 places the route must pass through, e.g. the walker's own way.
export async function walkingRoute(from, to, via = []) {
  const res = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
    method: 'POST',
    headers: { appKey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startX: from.lng, startY: from.lat, endX: to.lng, endY: to.lat,
      startName: 'start', endName: 'destination',
      reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO',
      ...(via.length ? { passList: via.slice(0, 5).map(v => `${v.lng},${v.lat}`).join('_') } : {}),
    }),
  });
  if (!res.ok) throw new Error(`TMAP ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const summary = data.features[0].properties;
  const line = data.features
    .filter(f => f.geometry.type === 'LineString')
    .flatMap(f => f.geometry.coordinates);
  // Features alternate: a point, then the stretch(es) walked after it until the next point.
  const points = [];
  for (const f of data.features) {
    const p = f.properties;
    if (f.geometry.type === 'Point') {
      points.push({
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        turnType: p.turnType,
        action: TURNS[p.turnType] || `type ${p.turnType}`,
        description: p.description,
        tmapLandmark: p.nearPoiName || p.name || null,
        intersection: p.intersectionName || null,
        segs: [],
      });
    } else if (points.length) {
      // facilityType 15 = crosswalk (TMAP pedestrian route docs).
      points.at(-1).segs.push({ road: p.name || null, distance: p.distance || 0, crosswalk: p.facilityType === '15' || p.facilityType === 15 });
    }
  }
  // The leg after each decision point: distance, streets and landmarks until the next decision.
  for (let i = 0; i < points.length; i++) {
    if (!isDecision(points[i].turnType) && points[i].turnType !== 200) continue;
    const leg = { distance: 0, roads: [], passes: [], crosswalk: false };
    for (let j = i; j < points.length; j++) {
      if (j > i && (isDecision(points[j].turnType) || points[j].turnType === 201)) break;
      if (j > i && points[j].tmapLandmark) leg.passes.push(points[j].tmapLandmark);
      for (const s of points[j].segs) {
        leg.distance += s.distance;
        if (s.road && !GENERIC_ROADS.includes(s.road) && !leg.roads.includes(s.road)) leg.roads.push(s.road);
        leg.crosswalk ||= s.crosswalk;
      }
    }
    points[i].leg = leg;
  }

  // The direction the walker is facing as they arrive at each point, so landmarks
  // there can be described as left or right.
  const verts = line.map(([lng, lat]) => ({ lat, lng }));
  for (const p of points) {
    let i = 0, best = Infinity;
    verts.forEach((v, k) => { const d = distance(v, p); if (d < best) { best = d; i = k; } });
    let j = i;
    while (j > 0 && distance(verts[j], p) < 15) j--;
    p.heading = j < i ? bearing(verts[j], p) : null; // the start point has no arrival direction
    p.approach = j < i ? verts[j] : null; // a spot ~15 m before the point, on the way in
  }

  return {
    distance: summary.totalDistance,
    time: summary.totalTime,
    startLeg: points[0]?.leg, // from the start to the first decision
    line: verts, // [{ lat, lng }, ...] along the whole route
    points,
    decisions: points.filter(p => isDecision(p.turnType)),
  };
}
