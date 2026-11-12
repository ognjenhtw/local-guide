import { log } from './log.js';
import { loadKakao, searchPlaces, placesNear, findNear, areaAt, LANDMARK_TYPES, SURROUNDING_TYPES } from './kakao.js';
import { walkingRoute } from './tmap.js';
import { PROVIDERS, createSession } from './providers/index.js';
import { outboundInstruction, returnInstruction, Navigator, TOOLS } from './guide.js';
import { side, distance, lineDistance } from './geo.js';
import { profileNames, getProfile, saveLandmark, WalkLog, exportWalks } from './profile.js';

// Used when the device can't give a GPS fix (e.g. testing on a laptop).
const FALLBACK_START = { lat: 37.5568, lng: 126.9237, label: 'Hongik Univ. Station (test start)' };

const $ = id => document.getElementById(id);
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// --- Settings: provider, model, voice, keys ------------------------------------

const settings = {
  provider: () => $('provider').value,
  model: () => $('model').value,
  voice: () => $('voice').value,
  key: () => $(`key-${$('provider').value}`).value.trim(),
};

function fillOptions(select, values, chosen) {
  select.innerHTML = values.map(v => `<option>${v}</option>`).join('');
  if (values.includes(chosen)) select.value = chosen;
}

function setupSettings() {
  $('provider').innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('');
  $('provider').value = store.get('provider', 'gemini');
  const refresh = () => {
    const p = PROVIDERS[settings.provider()];
    fillOptions($('model'), p.models, store.get(`model.${settings.provider()}`));
    fillOptions($('voice'), p.voices, store.get(`voice.${settings.provider()}`));
  };
  refresh();
  $('provider').onchange = () => { store.set('provider', settings.provider()); refresh(); };
  $('model').onchange = () => store.set(`model.${settings.provider()}`, settings.model());
  $('voice').onchange = () => store.set(`voice.${settings.provider()}`, settings.voice());
  $('key-gemini').value = store.get('geminiKey', import.meta.env.VITE_GEMINI_API_KEY || '');
  $('key-openai').value = store.get('openaiKey', import.meta.env.VITE_OPENAI_API_KEY || '');
  $('key-gemini').onchange = () => store.set('geminiKey', $('key-gemini').value.trim());
  $('key-openai').onchange = () => store.set('openaiKey', $('key-openai').value.trim());
  $('search').checked = store.get('search') === '1';
  $('search').onchange = () => store.set('search', $('search').checked ? '1' : '');
  $('export-btn').onclick = exportWalks;
}

// --- Profile ------------------------------------------------------------------------

const profile = () => $('profile-input').value.trim() || 'guest';

function showProfile() {
  const p = getProfile(profile());
  store.set('profile', p.name);
  $('profile-info').textContent = `${p.landmarks.length} landmark${p.landmarks.length === 1 ? '' : 's'} on ${p.name}'s map`;
}

function setupProfile() {
  $('profile-list').innerHTML = profileNames().map(n => `<option value="${n}">`).join('');
  $('profile-input').value = store.get('profile', '');
  $('profile-input').onchange = showProfile;
  if ($('profile-input').value) showProfile();
}

// --- Search and route ----------------------------------------------------------------

function currentPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(FALLBACK_START);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, label: 'the starting point' }),
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

// A walking route with landmarks at each turn: up to three Kakao places, described from
// where the walker arrives, plus any of the walker's own landmarks close by.
async function buildRoute(from, to, personal) {
  const route = await walkingRoute(from, to);
  route.dest = to;
  route.personal = personal.filter(m => lineDistance(m, route.line) < 50);
  await Promise.all(route.decisions.map(async turn => {
    const found = await placesNear(turn, 30, LANDMARK_TYPES, 3);
    turn.landmarks = found.map(p => ({
      ...p,
      side: turn.heading != null ? side(turn.approach, turn.heading, p) : undefined,
      distance: distance(turn, p),
    }));
    turn.personal = route.personal.filter(m => distance(turn, m) < 40)
      .map(m => ({ ...m, side: turn.heading != null ? side(turn.approach, turn.heading, m) : undefined }));
  }));
  return route;
}

let route;

async function showRoute(dest) {
  $('results').innerHTML = '';
  $('route-section').hidden = false;
  $('route-title').textContent = dest.name;
  $('route-summary').textContent = 'Finding the walking route…';
  $('turns').innerHTML = '';
  $('start-btn').disabled = true;

  route = await buildRoute(start, dest, getProfile(profile()).landmarks);
  log(`route: ${route.distance} m, ${route.decisions.length} turns, ${route.personal.length} of your landmarks nearby`);
  $('route-summary').textContent = `${route.distance} m · about ${Math.round(route.time / 60)} min · ${route.decisions.length} turns`;
  for (const turn of route.decisions) {
    const li = document.createElement('li');
    li.className = 'turn';
    const marks = [
      ...turn.personal.map(m => `★ ${m.label}${m.place_name ? ` (${m.place_name})` : ''}`),
      ...turn.landmarks.map(p => `${p.name} <small>(${p.type}${p.side ? ', ' + p.side : ''})</small>`),
    ];
    li.innerHTML = `<b>${turn.action}</b>${marks.join('<br>') || turn.tmapLandmark || 'no landmark found'}<br><small>${turn.description}</small>`;
    $('turns').appendChild(li);
  }
  $('start-btn').disabled = false;
}

// --- Walking ---------------------------------------------------------------------------

let session, nav, walkLog, watchId, factTimer, chatTimer, wakeLock, phase;
let transcript = []; // [{ who, text }] for the way-back summary

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
  const t = transcript.at(-1);
  if (t && t.who === who) t.text += text; else transcript.push({ who, text });
  walkLog?.add('say', { who, text });
}

function toolHandler(name, args) {
  walkLog.add('tool', { name, args });
  const deps = {
    placesNear: pos => placesNear(pos, 60, SURROUNDING_TYPES, 12),
    findNear,
    areaAt,
    routeFrom: pos => walkingRoute(pos, nav.route.dest),
  };
  const run = {
    get_surroundings: () => nav.surroundings({ placesNear: deps.placesNear }),
    explore_direction: () => nav.explore(args.direction, { placesNear: p => placesNear(p, 70, SURROUNDING_TYPES, 8), areaAt, routeFrom: deps.routeFrom }),
    get_route_status: () => nav.routeStatus(),
    find_place: () => nav.find(args.search_terms || [], deps),
    remember_landmark: () => {
      const r = nav.remember(args, lm => saveLandmark(profile(), lm));
      showProfile();
      return r;
    },
    start_way_back: () => {
      if (phase !== 'there') return { note: 'Already on the way back.' };
      // Give the guide a moment to say its line before the switch.
      setTimeout(() => headBack().catch(err => log('ERROR', err.message)), 3000);
      return { switching: true, note: 'Say one short line; in a moment you switch to the way back.' };
    },
  }[name];
  const result = run ? run() : { error: `unknown tool ${name}` };
  Promise.resolve(result).then(r => log(`tool ${name}`, r));
  return result;
}

async function openSession(instructions) {
  const s = createSession(settings.provider(), {
    apiKey: settings.key(),
    model: settings.model(),
    voice: settings.voice(),
    instructions,
    tools: TOOLS,
    search: $('search').checked,
    onToolCall: toolHandler,
    onTranscript: addLine,
    onCost: usd => { $('phase').dataset.cost = `≈ $${usd.toFixed(3)}`; showPhase(); },
  });
  await s.start(); // inside the tap, so iOS allows the microphone and audio
  return s;
}

function showPhase() {
  const cost = $('phase').dataset.cost;
  $('phase').textContent = `${phase === 'back' ? 'Way back: you lead' : 'Way there: Local leads'}${cost ? ` · ${cost}` : ''}`;
}

// Live GPS → navigator → [NAV] facts and moments worth a reply.
function trackPosition() {
  let announced = -1, nudged = false, offAlerted = false, arrivedSaid = false;
  watchId = navigator.geolocation.watchPosition(p => {
    nav.update({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
    walkLog.add('gps', { lat: nav.pos.lat, lng: nav.pos.lng, acc: Math.round(nav.pos.accuracy) });
    const facts = nav.facts();
    $('nav-status').textContent = facts.replace('[NAV] ', '');

    if (nav.isOff() && !offAlerted) {
      offAlerted = true;
      session.sendFacts(`${facts} The walker has gone off the route by ${nav.offRoute()} m.`, true);
    }
    if (nav.offRoute() < 20) offAlerted = false;

    if (nav.arrived() && !arrivedSaid) {
      arrivedSaid = true;
      session.sendFacts(phase === 'there'
        ? '[NAV] They have arrived at the destination. Say so, and that whenever they want to head back, they lead.'
        : '[NAV] They made it back to the start on their own. React like a friend would.', true);
    }

    if (phase !== 'there') return; // on the way back the guide only speaks when asked or off route
    const turn = nav.turns[nav.next];
    if (turn && distance(nav.pos, turn) < 40 && announced !== nav.next) {
      announced = nav.next;
      session.sendFacts(`${facts} The turn is coming up: tell them, with its landmark and side.`, true);
    }
    const still = nav.stillFor();
    if (still >= 15 && !nudged) { nudged = true; session.sendFacts(`${facts} The walker has stopped.`, true); }
    if (still < 3) nudged = false;
  }, e => log('GPS error:', e.message), { enableHighAccuracy: true, maximumAge: 0 });

  // Routine facts every 8 s, added silently so the guide stays up to date.
  factTimer = setInterval(() => nav.pos && session.sendFacts(nav.facts(), false), 8000);
}

function stopTracking() {
  clearInterval(factTimer);
  clearInterval(chatTimer);
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
}

async function startWalk() {
  if (!route) return log('Pick a destination first');
  if (!settings.key()) return log(`Enter the ${PROVIDERS[settings.provider()].label} API key in Settings`);
  phase = 'there';
  transcript = [];
  $('transcript').innerHTML = '';
  $('route-section').hidden = true;
  $('walk-section').hidden = false;
  $('phase').dataset.cost = '';
  showPhase();

  walkLog = new WalkLog({ profile: profile(), provider: settings.provider(), model: settings.model(), voice: settings.voice(), start, dest: route.dest });
  nav = new Navigator(route, route.personal.slice());
  nav.update({ ...start, accuracy: start.accuracy || 30 }); // until the first GPS fix arrives

  session = await openSession(outboundInstruction(route.dest, route, route.personal));
  session.sendFacts('[NAV] The walker is ready at the start. Say hi like a friend picking up the phone, and get them going.', true);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }
  trackPosition();
}

// The turnover: a fresh route back, and new instructions in which the walker leads.
// The voice line stays open, so this also works by voice with the phone in a pocket.
async function headBack() {
  if (phase !== 'there') return;
  stopTracking();
  phase = 'back';
  showPhase();
  addLine('note', ' — heading back — ');

  const here = nav.pos;
  const backRoute = await buildRoute(here, { ...start, name: start.label }, getProfile(profile()).landmarks);
  walkLog.add('phase', { phase: 'back', route_m: backRoute.distance });
  nav = new Navigator(backRoute, backRoute.personal.slice());
  nav.update(here);

  const recent = transcript.filter(t => t.who !== 'note').slice(-30)
    .map(t => `${t.who === 'guide' ? 'You' : 'Walker'}: ${t.text.trim()}`).join('\n').slice(-3000);
  await session.switchInstructions(returnInstruction(start, backRoute, backRoute.personal, recent));
  session.sendFacts('[NAV] The walker is starting the way back and leads now. Hand over casually in one line; no directions.', true);
  trackPosition();

  // Now and then, room for a little chat; the guide decides whether to say anything.
  chatTimer = setInterval(() => {
    if (nav.stillFor() < 10) session.sendFacts('[NAV] It has been quiet for a while. If it feels natural, say something short and light. No directions.', true);
  }, 180000);
}

function stopWalk() {
  stopTracking();
  session?.close();
  wakeLock?.release?.();
  walkLog?.add('end', {});
  walkLog?.save();
  $('walk-section').hidden = true;
  $('route-section').hidden = false;
  log('walk stopped and saved');
}

$('start-btn').onclick = () => startWalk().catch(err => log('ERROR', err.message));
$('back-btn').onclick = () => headBack().catch(err => log('ERROR', err.message));
$('stop-btn').onclick = stopWalk;
$('search-form').addEventListener('submit', e => onSearch(e).catch(err => log('ERROR', err.message)));

setupSettings();
setupProfile();
loadKakao()
  .then(() => log('Kakao ready'))
  .catch(err => log('ERROR', err.message));
