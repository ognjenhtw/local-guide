// A small map in the Log section: where the app thinks the walker is, the GPS error
// circle, and the route. For testing only; walkers never need to look at it.
let map, marker, circle, line;

function ll(p) { return new window.kakao.maps.LatLng(p.lat, p.lng); }

export function showPosition(pos) {
  const el = document.getElementById('map');
  if (!el || !window.kakao?.maps?.Map) return;
  if (!map) {
    map = new window.kakao.maps.Map(el, { center: ll(pos), level: 3 });
    marker = new window.kakao.maps.Marker({ position: ll(pos), map });
    circle = new window.kakao.maps.Circle({ center: ll(pos), radius: pos.accuracy || 30, strokeWeight: 1, strokeColor: '#1f6feb', fillColor: '#1f6feb', fillOpacity: 0.15, map });
    // The map sits in a collapsed section; redraw it when the section opens.
    document.getElementById('debug').addEventListener('toggle', () => { map.relayout(); map.setCenter(marker.getPosition()); });
  }
  marker.setPosition(ll(pos));
  circle.setPosition(ll(pos));
  circle.setRadius(pos.accuracy || 30);
}

export function showRoute(points) {
  if (!map) return;
  line?.setMap(null);
  line = new window.kakao.maps.Polyline({ path: points.map(ll), strokeWeight: 4, strokeColor: '#f97066', strokeOpacity: 0.8, map });
}
