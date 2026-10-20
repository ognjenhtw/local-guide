import { log } from './log.js';
import { loadKakao, searchPlaces, landmarkNear } from './kakao.js';
import { walkingRoute } from './tmap.js';
import { LiveSession } from './gemini.js';
import { startAudio, play, stopPlayback, stopAudio } from './audio.js';
import { outboundInstruction, Navigator } from './guide.js';

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
  route.dest = dest;
  window.currentRoute = route;
}

// --- Walking: live voice + GPS ---------------------------------------------

const keyInput = $('gemini-key');
try { keyInput.value = localStorage.getItem('geminiKey') || import.meta.env.VITE_GEMINI_API_KEY || ''; } catch { /* storage blocked */ }
keyInput.onchange = () => { try { localStorage.setItem('geminiKey', keyInput.value.trim()); } catch { /* storage blocked */ } };

let session, watchId, navigator_, factTimer, wakeLock;

function addLine(who, text) {
  const box = $('transcript');
  const last = box.lastElementChild;
  // Transcripts arrive in fragments; keep extending the current speaker's line.
  if (last && last.dataset.who === who) last.textContent += text;
  else {
    const p = document.createElement('p');
    p.dataset.who = who;
    p.className = who;
    p.textContent = text;
    box.appendChild(p);
  }
}

async function startWalk() {
  const route = window.currentRoute;
  const apiKey = keyInput.value.trim();
  if (!route) return log('Pick a destination first');
  if (!apiKey) return log('Enter the Gemini API key in Settings');

  $('route-section').hidden = true;
  $('walk-section').hidden = false;

  session = new LiveSession({
    apiKey,
    systemInstruction: outboundInstruction(route.dest, route),
    onAudio: play,
    onInterrupted: stopPlayback,
    onTranscript: addLine,
  });
  await startAudio(chunk => session.sendAudio(chunk)); // inside the tap, so iOS allows audio
  await session.connect();
  session.sendFacts('[NAV] The walker is ready at the start. Greet them briefly and tell them how to begin.', true);

  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }

  navigator_ = new Navigator(route);
  let latest = null, announced = -1, nudged = false;
  watchId = navigator.geolocation.watchPosition(p => {
    latest = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    const f = navigator_.update(latest);
    $('nav-status').textContent = f.text.replace('[NAV] ', '');
    if (f.done) return;
    // Moments worth a reply: approaching the next turn, or standing still for a while.
    if (f.distance < 40 && announced !== navigator_.next) {
      announced = navigator_.next;
      session.sendFacts(`${f.text} The turn is coming up.`, true);
    }
    if (f.still >= 12 && !nudged) { nudged = true; session.sendFacts(`${f.text} The walker has stopped.`, true); }
    if (f.still < 3) nudged = false;
  }, e => log('GPS error:', e.message), { enableHighAccuracy: true, maximumAge: 0 });

  // Routine facts every 8 s, added silently so the guide stays up to date.
  factTimer = setInterval(() => latest && session.sendFacts(navigator_.update(latest).text, false), 8000);
}

function stopWalk() {
  clearInterval(factTimer);
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  session?.close();
  stopAudio();
  wakeLock?.release?.();
  $('walk-section').hidden = true;
  $('route-section').hidden = false;
  log('walk stopped');
}

$('start-btn').onclick = () => startWalk().catch(err => log('ERROR', err.message));
$('stop-btn').onclick = stopWalk;

$('search-form').addEventListener('submit', e => onSearch(e).catch(err => log('ERROR', err.message)));

loadKakao()
  .then(() => log('Kakao ready'))
  .catch(err => log('ERROR', err.message));
