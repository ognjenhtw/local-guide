// The checkpoint picture: Kakao Roadview (street view), from a spot just before the turn, turned to
// face what marks it. Checked 2026-11-15 with our key: it shows e.g. the little rotary clearly.
import { bearing } from './geo.js';

let rv, client, ready;

function setup(el) {
  if (rv) return true;
  if (!window.kakao?.maps?.Roadview) return false;
  rv = new window.kakao.maps.Roadview(el);
  client = new window.kakao.maps.RoadviewClient();
  // The first picture fires 'init', later ones 'panoid_changed'.
  ready = new Promise(resolve => window.kakao.maps.event.addListener(rv, 'init', resolve));
  return true;
}

// Show the view from `from` towards `look`. Resolves false when there's no street view nearby.
export async function showView(el, from, look) {
  if (!setup(el)) return false;
  const at = new window.kakao.maps.LatLng(from.lat, from.lng);
  const panoId = await new Promise(resolve => client.getNearestPanoId(at, 50, resolve));
  if (!panoId) return false;
  const changed = new Promise(resolve => {
    const done = () => { window.kakao.maps.event.removeListener(rv, 'panoid_changed', done); resolve(); };
    window.kakao.maps.event.addListener(rv, 'panoid_changed', done);
    setTimeout(done, 2500);
  });
  rv.setPanoId(panoId, at);
  await Promise.race([Promise.all([ready, changed]), new Promise(r => setTimeout(r, 3000))]);
  const p = rv.getPosition();
  rv.setViewpoint({ pan: bearing({ lat: p.getLat(), lng: p.getLng() }, look), tilt: 0, zoom: 0 });
  rv.relayout();
  return true;
}
