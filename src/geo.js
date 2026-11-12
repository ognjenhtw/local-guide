// Small geometry helpers on latitude/longitude points ({ lat, lng }).
const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;

export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Compass bearing from a to b, 0 = north, 90 = east.
export function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Where `target` is for someone at `from` facing `heading`: ahead, left, right or behind.
export function side(from, heading, target) {
  const rel = ((bearing(from, target) - heading + 540) % 360) - 180; // -180..180
  if (Math.abs(rel) <= 30) return 'ahead';
  if (Math.abs(rel) >= 150) return 'behind';
  if (rel < 0) return Math.abs(rel) < 60 ? 'ahead on the left' : 'on the left';
  return rel < 60 ? 'ahead on the right' : 'on the right';
}

// The point `meters` away from `from` in the direction `deg`.
export function destinationPoint(from, deg, meters) {
  const d = meters / 6371000, b = toRad(deg), la = toRad(from.lat), lo = toRad(from.lng);
  const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lng = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
  return { lat: toDeg(lat), lng: toDeg(lng) };
}

// Distance from point p to the segment a–b, in metres (flat-earth approximation, fine at street scale).
export function segmentDistance(p, a, b) {
  const k = Math.cos(toRad(p.lat)) * 111320, m = 110540;
  const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * m, bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * m;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// Distance from p to the nearest point of a polyline [{ lat, lng }, ...].
export function lineDistance(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(p, line[i - 1], line[i]));
  return best;
}

const COMPASS =['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = deg => COMPASS[Math.round(deg / 45) % 8];
