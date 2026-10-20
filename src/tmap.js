// TMAP pedestrian route API (SK Open API). Called directly from the browser.
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
const isDecision = t => t !== 11 && t !== 200 && t !== 233 && TURNS[t] !== undefined;

export async function walkingRoute(from, to) {
  const res = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
    method: 'POST',
    headers: { appKey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startX: from.lng, startY: from.lat, endX: to.lng, endY: to.lat,
      startName: 'start', endName: 'destination',
      reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO',
    }),
  });
  if (!res.ok) throw new Error(`TMAP ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const summary = data.features[0].properties;
  const line = data.features
    .filter(f => f.geometry.type === 'LineString')
    .flatMap(f => f.geometry.coordinates);
  const points = data.features
    .filter(f => f.geometry.type === 'Point')
    .map(f => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      turnType: f.properties.turnType,
      action: TURNS[f.properties.turnType] || `type ${f.properties.turnType}`,
      description: f.properties.description,
      tmapLandmark: f.properties.nearPoiName || null,
    }));

  return {
    distance: summary.totalDistance,
    time: summary.totalTime,
    line, // [[lng, lat], ...] for route-following later
    points,
    decisions: points.filter(p => isDecision(p.turnType)),
  };
}
