import { log } from './log.js';
import { loadKakao, searchPlaces, placesNear, findNear, SURROUNDING_TYPES } from './kakao.js';
import { buildRoute } from './route.js';
import { PROVIDERS, createVoice } from './providers/index.js';
import { MIND_MODELS } from './mind.js';
import { Walk } from './walk.js';
import { profileNames, getProfile, saveLandmark, saveInterest, WalkLog, exportWalks, walksOf, deleteWalk, transcriptOf } from './profile.js';
import { showPosition, showRoute as showRouteOnMap } from './debugmap.js';

// Used when the device can't give a GPS fix (e.g. testing on a laptop).
const FALLBACK_START = { lat: 37.5568, lng: 126.9237, accuracy: 500, label: 'Hongik Univ. Station (test start)' };

const $ = id => document.getElementById(id);
const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// --- Settings: voice, models, keys (stored under the same names as before, so phones keep them) ---

const voiceInfo = PROVIDERS.openai;
const settings = {
  model: () => $('model').value,
  voice: () => $('voice').value,
  mindModel: () => $('brain-model').value,
  openaiKey: () => $('key-openai').value.trim(),
  claudeKey: () => $('key-claude').value.trim(),
};

function fillOptions(select, values, chosen) {
  select.innerHTML = values.map(v => `<option>${v}</option>`).join('');
  if (values.includes(chosen)) select.value = chosen;
}

function setupSettings() {
  fillOptions($('model'), voiceInfo.models, store.get('model.openai'));
  fillOptions($('voice'), voiceInfo.voices, store.get('voice.openai'));
  fillOptions($('brain-model'), MIND_MODELS, store.get('brainModel.claude'));
  $('model').onchange = () => store.set('model.openai', settings.model());
  $('voice').onchange = () => store.set('voice.openai', settings.voice());
  $('brain-model').onchange = () => store.set('brainModel.claude', settings.mindModel());
  $('key-openai').value = store.get('openaiKey', import.meta.env.VITE_OPENAI_API_KEY || '');
  $('key-claude').value = store.get('claudeKey', import.meta.env.VITE_ANTHROPIC_API_KEY || '');
  $('key-openai').onchange = () => store.set('openaiKey', settings.openaiKey());
  $('key-claude').onchange = () => store.set('claudeKey', settings.claudeKey());
  $('export-btn').onclick = exportWalks;
}

// --- Profile ------------------------------------------------------------------------

const profile = () => $('profile-input').value.trim() || 'guest';

function showProfile() {
  const p = getProfile(profile());
  store.set('profile', p.name);
  $('profile-info').textContent = `${p.landmarks.length} landmark${p.landmarks.length === 1 ? '' : 's'} on ${p.name}'s map`;
  showWalks();
}

// "My walks": this profile's past conversations, to read or delete.
function showWalks() {
  const walks = walksOf(profile());
  $('walks-title').textContent = `My walks (${walks.length})`;
  const ul = $('walk-list');
  ul.innerHTML = '';
  $('walk-view').innerHTML = '';
  for (const w of walks) {
    const li = document.createElement('li');
    const when = new Date(w.started).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span>${when} · ${w.dest?.name || 'walk'} <small>(${w.provider})</small></span>`;
    const view = Object.assign(document.createElement('button'), { className: 'secondary small', textContent: 'Read' });
    const del = Object.assign(document.createElement('button'), { className: 'secondary small danger-text', textContent: 'Delete' });
    view.onclick = () => {
      $('walk-view').innerHTML = '';
      for (const line of transcriptOf(w)) {
        const p = document.createElement('p');
        p.className = line.who;
        p.textContent = line.who === 'note' ? line.text : `${line.who === 'guide' ? 'Local' : 'You'}: ${line.text}`;
        $('walk-view').appendChild(p);
      }
      if (!$('walk-view').children.length) $('walk-view').textContent = 'Nothing was said on this walk.';
    };
    del.onclick = () => {
      if (!confirm(`Delete the walk from ${when}? This can't be undone.`)) return;
      deleteWalk(w.id);
      showWalks();
    };
    li.append(view, del);
    ul.appendChild(li);
  }
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
  log('start:', start.label, start.lat.toFixed(5), start.lng.toFixed(5), `±${Math.round(start.accuracy || 0)} m`);
  const results = await searchPlaces(q, start);
  log(`search "${q}": ${results.length} results`);
  const ul = $('results');
  ul.innerHTML = '';
  for (const p of results.slice(0, 8)) {
    const li = document.createElement('li');
    li.innerHTML = `${p.place_name}<br><small>${p.road_address_name || p.address_name} · ${p.distance} m</small>`;
    // The kind of place ("음식점 > 패스트푸드 > 햄버거") lets the guide open with a fitting comment.
    li.onclick = () => showRoute({ name: p.place_name, kind: p.category_name, lat: Number(p.y), lng: Number(p.x) });
    ul.appendChild(li);
  }
}

let route;

async function showRoute(dest) {
  $('results').innerHTML = '';
  $('route-section').hidden = false;
  $('route-title').textContent = dest.name;
  $('route-summary').textContent = 'Finding the walking route…';
  $('turns').innerHTML = '';
  $('start-btn').disabled = true;

  const p = getProfile(profile());
  route = await buildRoute(start, dest, { personal: p.landmarks, likes: p.likes || [] });
  prepareWalk(); // the guide's opener gets written now, so it plays the moment they tap Start
  log(`route: ${route.distance} m, ${route.decisions.length} turns, built in ${route.buildMs} ms${route.streetsError ? `, no street layout (${route.streetsError})` : ''}`);
  $('route-summary').textContent = `${route.distance} m · about ${Math.round(route.time / 60)} min · ${route.decisions.length} turns`;
  // Check the start: a route planned from the wrong spot is wrong from the first turn.
  const near = await placesNear(start, 40, SURROUNDING_TYPES, 2);
  $('start-info').textContent = start.fixed
    ? `Starting at ${start.label} (you picked it)`
    : `Starting near ${near.map(n => n.name).join(', ') || 'an unnamed spot'} · GPS ±${Math.round(start.accuracy || 0)} m`;
  $('start-picker').hidden = true;
  route.decisions.forEach((turn, i) => {
    const li = document.createElement('li');
    li.className = 'turn';
    const f = route.features?.[i] || {};
    const marks = [
      ...turn.personal.map(m => `★ ${m.label}${m.place_name ? ` (${m.place_name})` : ''}`),
      ...turn.landmarks.map(l => `${l.name} <small>(${l.type}${l.side ? ', ' + l.side : ''})</small>`),
    ];
    const street = [f.rotary, f.crosses && `crosses ${f.crosses.name || f.crosses.size}`].filter(Boolean).join(' · ');
    li.innerHTML = `<b>${turn.action}</b>${street ? `<small>${street}</small><br>` : ''}${marks.join('<br>') || turn.tmapLandmark || 'no landmark found'}<br><small>${turn.description}</small>`;
    $('turns').appendChild(li);
  });
  $('start-btn').disabled = false;
}

// "That's not where I am": pick the real starting point from places nearby, or search for one.
function listStartOptions(places) {
  const ul = $('start-options');
  ul.innerHTML = places.length ? '' : '<li>Nothing found. Try another name.</li>';
  for (const p of places) {
    const li = document.createElement('li');
    li.innerHTML = `${p.name}<br><small>${p.type}${p.street ? ' · ' + p.street : ''} · ${Math.round(p.distance)} m from GPS</small>`;
    li.onclick = () => {
      start = { lat: p.lat, lng: p.lng, accuracy: 10, label: p.name, fixed: true };
      log('start set to', p.name);
      showRoute(route.dest).catch(err => log('ERROR', err.message));
    };
    ul.appendChild(li);
  }
}

$('fix-start-btn').onclick = async () => {
  $('start-picker').hidden = false;
  $('start-options').innerHTML = '<li>Looking around…</li>';
  listStartOptions(await placesNear(start, 300, SURROUNDING_TYPES, 15));
};
$('start-form').onsubmit = async e => {
  e.preventDefault();
  const q = $('start-search').value.trim();
  if (q) listStartOptions(await findNear(start, [q], 800, 10));
};

// --- Walking ---------------------------------------------------------------------------

let walk, voice, walkLog, watchId, wakeLock, costTimer, prepared, preparedVoice;

function makeVoice() {
  return createVoice({
    apiKey: settings.openaiKey(), model: settings.model(), voice: settings.voice(),
    onSpeechStart: () => walk?.talk.walkerStarted(),
    onSpeechStop: () => walk?.talk.walkerStopped(),
    onUtterance: text => {
      // Lone noises ("uh", a stray syllable) aren't shown or answered.
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) { addLine('walker', text.trim()); walkLog.add('heard', { text }); }
      walk?.talk.walkerSaid(text);
    },
  });
}

function addLine(who, text) {
  const p = document.createElement('p');
  p.className = who;
  p.textContent = who === 'note' ? text : `${who === 'guide' ? 'Local' : 'You'}: ${text}`;
  $('transcript').appendChild(p);
  walkLog?.add('say', { who, text: `${text} ` });
}

function showPhase(phase) {
  const cost = voice && walk ? ` · ≈ $${(voice.totalCost() + walk.mind.cost).toFixed(3)}` : '';
  $('phase').textContent = `${phase === 'back' ? 'Way back: you lead' : 'Way there: Local leads'}${cost}`;
}

// Openers from this profile's earlier walks, so the guide doesn't open the same way twice.
function pastOpeners() {
  return walksOf(profile()).slice(0, 4).map(w => transcriptOf(w).find(l => l.who === 'guide')?.text).filter(Boolean);
}

// The walk is set up as soon as the route is shown: the guide writes its opener while the
// walker is still looking at the route. It only speaks once they tap Start.
function prepareWalk() {
  if (!settings.claudeKey()) return;
  const p = getProfile(profile());
  const lineVoice = { say: line => voice.say(line), cut: () => voice?.cut() }; // the real voice connects on Start
  prepared = new Walk({
    voice: lineVoice, apiKey: settings.claudeKey(), model: settings.mindModel(), start, route,
    profile: { likes: p.likes || [] },
    deps: {
      buildRoute, findNear, placesNear, surroundingTypes: SURROUNDING_TYPES,
      saveLandmark: lm => { const n = saveLandmark(profile(), lm); showProfile(); return n; },
      saveInterest: i => saveInterest(profile(), i),
    },
    log: (type, data) => { log(type, data ?? ''); walkLog?.add('event', { what: type, data }); },
    onLine: text => addLine('guide', text),
    onRoute: r => { showRouteOnMap(r.line); walkLog?.add('route', { m: r.distance, turns: r.decisions.length }); },
    onPhase: ph => { showPhase(ph); addLine('note', '— heading back —'); walkLog?.add('phase', { phase: ph }); },
  });
  prepared.route0 = route;
  if (settings.openaiKey()) { preparedVoice = makeVoice(); preparedVoice.prefetch(); }
  prepared.talk.hold();
  prepared.begin({ ...start, accuracy: start.accuracy || 50 }, pastOpeners());
}

async function startWalk() {
  if (!route) return log('Pick a destination first');
  if (!settings.openaiKey()) return log('Enter the OpenAI API key in Settings (for the voice)');
  if (!settings.claudeKey()) return log('Enter the Claude API key in Settings (for what the guide says)');
  $('transcript').innerHTML = '';
  $('route-section').hidden = true;
  $('walk-section').hidden = false;

  walkLog = new WalkLog({ profile: profile(), provider: 'openai+claude', model: `${settings.model()} / ${settings.mindModel()}`, voice: settings.voice(), start, dest: route.dest });
  if (!prepared || prepared.route0 !== route) prepareWalk();
  walk = prepared;
  prepared = null;
  // Settings changed since the route was shown: a fresh voice with them.
  const same = preparedVoice && preparedVoice.model === settings.model() && preparedVoice.voice === settings.voice() && preparedVoice.apiKey === settings.openaiKey();
  voice = same ? preparedVoice : makeVoice();
  preparedVoice = null;
  showPhase('there');
  await voice.start(); // inside the tap, so iOS allows the microphone and audio
  walk.talk.release(); // the opener (written already) plays now
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }

  watchId = navigator.geolocation?.watchPosition(g => {
    const raw = { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: g.coords.accuracy };
    walk.position(raw).catch(err => log('ERROR', err.message));
    walkLog.add('gps', { lat: walk.nav.pos.lat, lng: walk.nav.pos.lng, acc: Math.round(raw.accuracy), corrected: !!walk.nav.correction });
    showPosition(walk.nav.pos);
    $('nav-status').textContent = walk.nav.status(walk.phase).replace('[status] ', '');
  }, e => log('GPS error:', e.message), { enableHighAccuracy: true, maximumAge: 0 });
  costTimer = setInterval(() => showPhase(walk.phase), 5000);
}

async function headBack() {
  if (!walk || walk.phase !== 'there') return;
  await walk.headBack();
  walk.talk.event('They tapped "Head back": the way back starts now and they lead. Hand over in one short, casual line; no directions.');
}

function stopWalk() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  clearInterval(costTimer);
  voice?.close();
  wakeLock?.release?.();
  walkLog?.add('end', { cost_usd: voice && walk ? +(voice.totalCost() + walk.mind.cost).toFixed(4) : null });
  walkLog?.save();
  walk = null;
  $('walk-section').hidden = true;
  $('route-section').hidden = false;
  showWalks();
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
