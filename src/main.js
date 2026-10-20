import { log } from './log.js';
import { loadKakao, searchPlaces, landmarkNear } from './kakao.js';
import { walkingRoute } from './tmap.js';

// Used when the device can't give a GPS fix (e.g. testing on a laptop).
const FALLBACK_START = { lat: 37.5568, lng: 126.9237, label: 'Hongik Univ. Station (test start)' };

const $ = id => document.getElementById(id);

function currentPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(FALLBACK_START);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, label: `GPS ±${Math.round(p.coords.accuracy)} m` }),
      e => { log('GPS unavailable:', e.message); resolve(FALLBACK_START); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

let start = FALLBACK_START;

async function onSearch(e) {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (!q) return;
  start = await currentPosition();
  log('start:', start.label, start.lat.toFixed(5), start.lng.toFixed(5));
  const results = await searchPlaces(q, start);
  log(`search "${q}": ${results.length} results`);
  const ul = $('results');
  ul.innerHTML = '';
  for (const p of results.slice(0, 8)) {
    const li = document.createElement('li');
    li.innerHTML = `${p.place_name}<br><small>${p.road_address_name || p.address_name} · ${p.distance} m</small>`;
    li.onclick = () => showRoute({ name: p.place_name, lat: Number(p.y), lng: Number(p.x) });
    ul.appendChild(li);
  }
}

async function showRoute(dest) {
  $('results').innerHTML = '';
  $('route-section').hidden = false;
  $('route-title').textContent = dest.name;
  $('route-summary').textContent = 'Finding the walking route…';
  $('turns').innerHTML = '';

  const route = await walkingRoute(start, dest);
  log(`route: ${route.distance} m, ${route.decisions.length} decision points`);
  $('route-summary').textContent = `${route.distance} m · about ${Math.round(route.time / 60)} min · ${route.decisions.length} turns`;

  for (const turn of route.decisions) {
    turn.landmark = await landmarkNear(turn);
    const li = document.createElement('li');
    li.className = 'turn';
    const mark = turn.landmark
      ? `${turn.landmark.name} (${turn.landmark.category}, ${turn.landmark.distance} m)`
      : turn.tmapLandmark || 'no landmark found';
    li.innerHTML = `<b>${turn.action}</b>${mark}<br><small>${turn.description}</small>`;
    $('turns').appendChild(li);
  }
  window.currentRoute = route; // handy for inspecting while testing
}

$('search-form').addEventListener('submit', e => onSearch(e).catch(err => log('ERROR', err.message)));

loadKakao()
  .then(() => log('Kakao ready'))
  .catch(err => log('ERROR', err.message));
