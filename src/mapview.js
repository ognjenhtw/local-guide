// The map on the home screen: where the walker is, the places they could go to (numbered pins),
// the one picked, and the route. Kakao Maps JavaScript SDK.
let map, me, meCircle, line;
let pins = [];

const ll = p => new window.kakao.maps.LatLng(p.lat, p.lng);

export function ensureMap(center) {
  if (map || !window.kakao?.maps?.Map) return map;
  map = new window.kakao.maps.Map(document.getElementById('home-map'), { center: ll(center), level: 4 });
  return map;
}

export function showMe(pos) {
  if (!ensureMap(pos)) return;
  if (!me) {
    me = new window.kakao.maps.CustomOverlay({ position: ll(pos), content: '<div class="me-dot"></div>', zIndex: 3 });
    me.setMap(map);
    meCircle = new window.kakao.maps.Circle({ center: ll(pos), radius: pos.accuracy || 30, strokeWeight: 1, strokeColor: '#1f6feb', strokeOpacity: 0.5, fillColor: '#1f6feb', fillOpacity: 0.1, map });
  }
  me.setPosition(ll(pos));
  meCircle.setPosition(ll(pos));
  meCircle.setRadius(Math.min(pos.accuracy || 30, 300));
}

// Numbered pins; tapping one calls onPick(n).
export function showOptions(options, onPick, around) {
  if (!ensureMap(options[0] || around)) return;
  clearOptions();
  const bounds = new window.kakao.maps.LatLngBounds();
  if (around) bounds.extend(ll(around));
  for (const o of options) {
    const el = document.createElement('button');
    el.className = 'pin';
    el.textContent = o.n;
    el.onclick = () => onPick(o.n);
    const pin = new window.kakao.maps.CustomOverlay({ position: ll(o), content: el, yAnchor: 1, zIndex: 2 });
    pin.setMap(map);
    pins.push({ n: o.n, pin, el });
    bounds.extend(ll(o));
  }
  map.setBounds(bounds, 60, 40, 60, 40);
}

export function highlight(n) {
  for (const p of pins) p.el.classList.toggle('chosen', p.n === n);
  const p = pins.find(x => x.n === n);
  if (p) map.panTo(p.pin.getPosition());
}

export function clearOptions() {
  for (const p of pins) p.pin.setMap(null);
  pins = [];
}

export function showRouteLine(points) {
  if (!ensureMap(points[0])) return;
  line?.setMap(null);
  line = new window.kakao.maps.Polyline({ path: points.map(ll), strokeWeight: 5, strokeColor: '#1f6feb', strokeOpacity: 0.85, map });
  const bounds = new window.kakao.maps.LatLngBounds();
  points.forEach(p => bounds.extend(ll(p)));
  map.setBounds(bounds, 50, 30, 50, 30);
}

// The map sits in a section that can be resized or shown later: redraw it.
export function relayout() { map?.relayout(); }
