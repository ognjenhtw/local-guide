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

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = deg => COMPASS[Math.round(deg / 45) % 8];
