import { log } from './log.js';
import { loadKakao, placesNear, findNear, SURROUNDING_TYPES } from './kakao.js';
import { destinationOptions, optionText } from './places.js';
import { ensureMap, showMe, showOptions, highlight, showRouteLine, showMarkers, relayout } from './mapview.js';
import { savePhoto, photoURL, shrinkPhoto } from './photos.js';
import { checkpointsOf, BRAND_COLORS } from './checkpoints.js';
import { showView } from './streetview.js';
import { buildRoute } from './route.js';
import { PROVIDERS, createVoice } from './providers/index.js';
import { MIND_MODELS } from './mind.js';
import { Walk } from './walk.js';
import { profileNames, getProfile, saveLandmark, updateLandmark, saveInterest, WalkLog, exportWalks, walksOf, deleteWalk, transcriptOf } from './profile.js';
import { showPosition, showRoute as showRouteOnMap } from './debugmap.js';


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

// One-time phone setup from a QR code: the link ends in #setup=<base64url of {"claude","openai"}>.
// The part after # is never sent to the web server, and it's removed from the address at once.
function applySetupLink() {
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const keys = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (keys.claude) store.set('claudeKey', keys.claude.trim());
    if (keys.openai) store.set('openaiKey', keys.openai.trim());
    log('keys saved from the setup link');
    setTimeout(() => alert('Keys saved on this device. You can close the QR code.'), 300);
  } catch {
    log('the setup link could not be read');
  }
}

function setupSettings() {
  applySetupLink();
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
  refreshMarkers();
}

// Only this person's own landmarks are ever shown.
function refreshMarkers() {
  const who = profile();
  showMarkers(getProfile(who).landmarks, lm => photoURL(who, lm.photo)).catch(err => log('markers:', err.message));
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

// Where the walker is right now. Never a made-up place: if the phone can't tell, it says why.
// Indoors a precise fix can take long, so after 12 s a rougher one (Wi-Fi) is fine: the guide
// checks the start with the walker anyway.
// Which browser the page is running in (a link opened from the Camera goes to the default browser,
// which may not be the Safari the walker normally uses).
function browserName() {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/FxiOS/.test(ua)) return 'Firefox';
  if (/EdgiOS/.test(ua)) return 'Edge';
  if (/(FBAN|FBAV|Instagram|KAKAOTALK|Line|NAVER|Whale)/i.test(ua)) return 'an app\'s built-in browser';
  if (/iPhone|iPad/.test(ua) && /Safari/.test(ua)) return 'Safari';
  return 'this browser';
}

// Location was refused without the walker being asked: say exactly where to switch it on.
async function blockedMessage(e) {
  let state = 'unknown';
  try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* not supported */ }
  const b = browserName();
  const where = b === 'Safari'
    ? 'Safari has location blocked for this website. Tap "aA" (left of the address) → Website Settings → Location → Allow, then reload.'
    : b === 'Chrome' || b === 'Firefox' || b === 'Edge'
      ? `This page is open in ${b}, not Safari. Either allow location for ${b} (iPhone Settings → ${b} → Location → While Using the App) and reload, or open ognjenhtw.github.io/local-guide in Safari. Keys from the QR code are only saved in the browser that opened it.`
      : `This page is open in ${b}. Open ognjenhtw.github.io/local-guide in Safari instead.`;
  return `${where} [${b}, location permission: ${state}, error ${e.code}: ${e.message}]`;
}
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't give a location."));
    const ok = p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, label: 'the starting point' });
    navigator.geolocation.getCurrentPosition(ok, e => {
      if (e.code === 1) return blockedMessage(e).then(m => reject(new Error(m)));
      log('precise location not ready:', e.message, '- trying a rougher one');
      navigator.geolocation.getCurrentPosition(ok,
        e2 => e2.code === 1 ? blockedMessage(e2).then(m => reject(new Error(m)))
          : reject(new Error(`The phone couldn't find where you are (${e2.message}). Try again near a window or outside.`)),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}

let start = null; // where they are now: for searching and as the start of the route
let options = []; // what the search found, numbered like the pins on the map

// Find where they are and put them on the map; a problem shows right under the map.
async function findMe() {
  $('where').textContent = 'Finding where you are…';
  $('where').className = 'muted';
  try {
    start = await currentPosition();
    showMe(start);
    $('where').textContent = '';
    log('start:', start.lat.toFixed(5), start.lng.toFixed(5), `±${Math.round(start.accuracy || 0)} m`);
    return start;
  } catch (err) {
    start = null;
    $('where').textContent = err.message;
    $('where').className = 'warning';
    log('no location:', err.message);
    return null;
  }
}

async function onSearch(e) {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (!q) return;
  if (!walk && !start && !await findMe()) return;
  $('results').innerHTML = '<li class="muted">Searching…</li>';
  // In a call the guide gets the same options, with the way to each, and helps pick.
  const found = await destinationOptions(walk ? walk.pos : start, q, { detailed: walk ? 3 : 0 });
  log(`search "${q}": ${found.length} results`);
  showFound(found);
  if (walk) {
    walk.options = found;
    walk.talk.event(`They typed "${q}" in the search box. The matches are numbered pins on their screen: ${found.map(optionText).join(' | ') || 'none'}. Help them pick, talking as if they can't see the screen.`);
  }
}

// The options as numbered pins on the map and a list under it; tapping either one picks it.
function showFound(found) {
  options = found;
  const ul = $('results');
  ul.innerHTML = found.length ? '' : '<li class="muted">Nothing like that nearby. Try another name.</li>';
  for (const o of found) {
    const li = document.createElement('li');
    li.dataset.n = o.n;
    li.innerHTML = `<b class="num">${o.n}</b>${o.name}<br><small>${[o.street, `${Math.round(o.distance)} m`, o.station && `near ${o.station.name}`].filter(Boolean).join(' · ')}</small>`;
    li.onclick = () => pick(o.n);
    ul.appendChild(li);
  }
  if (found.length) showOptions(found, pick, walk ? walk.pos : start);
}

function markChosen(n) {
  highlight(n);
  for (const li of $('results').children) li.classList.toggle('chosen', li.dataset.n === String(n));
}

// They picked one on the screen.
async function pick(n) {
  const o = options.find(x => x.n === n);
  if (!o) return;
  markChosen(n);
  if (walk) {
    // In a call: the route is set and the guide confirms it by voice.
    walk.options = options;
    await walk.goTo(n);
    walk.talk.event(`They picked one on the screen: ${optionText(o)}. The route there is set. React to where they're going in a few words, like a friend, and carry on.`);
    return;
  }
  showRoute({ name: o.name, kind: [o.type, o.kind].filter(Boolean).join(' > '), lat: o.lat, lng: o.lng });
}

let route;

async function showRoute(dest) {
  for (const id of ['start-btn', 'fix-start-btn', 'start-info']) $(id).hidden = false;
  $('route-section').hidden = false;
  $('route-title').textContent = dest.name;
  $('route-summary').textContent = 'Finding the walking route…';
  $('turns').innerHTML = '';
  $('start-btn').disabled = true;

  const p = getProfile(profile());
  route = await buildRoute(start, dest, { personal: p.landmarks, likes: p.likes || [] });
  showRouteLine(route.line);
  setCheckpoints(route);
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

// --- The map during a walk ---------------------------------------------------------------
// Once the route is set the map folds away: they should learn the way, not stare at a map. It can
// be opened, and every open and close is logged (how much each walker leans on the map).

function foldMap() {
  $('home-map').hidden = true;
  $('map-btn').hidden = false;
  $('map-btn').textContent = 'Show map';
}

$('map-btn').onclick = () => {
  const open = $('home-map').hidden;
  $('home-map').hidden = !open;
  $('map-btn').textContent = open ? 'Hide map' : 'Show map';
  if (open) relayout();
  walkLog?.add('event', { what: open ? 'map opened' : 'map closed', phase: walk?.phase || null, next_turn: walk?.nav ? walk.nav.next + 1 : null });
};

// --- Checkpoints: what each turn looks like ---------------------------------------------

let checkpoints = [], cpIndex = 0, cpFlippedAt = 0;

function setCheckpoints(r, at = 0) {
  checkpoints = r ? checkpointsOf(r) : [];
  $('checkpoint').hidden = !checkpoints.length;
  if (checkpoints.length) showCheckpoint(at);
}

async function showCheckpoint(i) {
  cpIndex = Math.max(0, Math.min(i, checkpoints.length - 1));
  const cp = checkpoints[cpIndex];
  $('cp-title').textContent = `${cp.n}/${checkpoints.length} · ${cp.title}`;
  $('cp-sub').textContent = cp.sub;
  $('cp-prev').disabled = cpIndex === 0;
  $('cp-next').disabled = cpIndex === checkpoints.length - 1;
  const b = cp.brand && BRAND_COLORS[cp.brand];
  $('cp-brand').hidden = !b;
  if (b) Object.assign($('cp-brand'), { textContent: cp.brand }), Object.assign($('cp-brand').style, { background: b[0], color: b[1] });
  // Their own photo of the landmark, if they took one; otherwise the street view.
  const own = cp.photoOf ? await photoURL(profile(), cp.photoOf.photo).catch(() => null) : null;
  $('cp-photo').hidden = !own;
  if (own) { $('cp-photo').src = own; $('cp-none').hidden = true; return; }
  const shown = await showView($('cp-view'), cp.from, cp.look).catch(err => { log('street view:', err.message); return false; });
  if (checkpoints[cpIndex] === cp) $('cp-none').hidden = shown;
}

$('cp-prev').onclick = () => { cpFlippedAt = Date.now(); showCheckpoint(cpIndex - 1); };
$('cp-next').onclick = () => { cpFlippedAt = Date.now(); showCheckpoint(cpIndex + 1); };
$('cp-check').onclick = () => $('check-input').click();
$('check-input').onchange = async () => {
  const file = $('check-input').files[0];
  $('check-input').value = '';
  if (!file || !walk) return;
  const cp = checkpoints[cpIndex];
  try {
    const { base64 } = await shrinkPhoto(file);
    addLine('note', '(photo: is this it?)');
    walk.checkPhoto(base64, `${cp.title}${cp.sub ? ` ${cp.sub}` : ''}`);
  } catch (err) { log('photo failed:', err.message); }
};

// --- Walking ---------------------------------------------------------------------------

let walk, voice, walkLog, watchId, wakeLock, costTimer, prepared, preparedVoice;

function makeVoice() {
  return createVoice({
    apiKey: settings.openaiKey(), model: settings.model(), voice: settings.voice(),
    onSpeechStart: id => { walk?.noteSpeech(); walk?.talk.walkerStarted(id); },
    onSpeechStop: id => { walkLog?.add('event', { what: 'walker stopped' }); walk?.talk.walkerStopped(id); },
    onPlaying: () => walkLog?.add('event', { what: 'voice playing' }), // with 'walker stopped': the reply delay
    onUtterance: (text, id) => {
      // Noise, echo and lone "uh"s aren't shown or answered.
      if (walk?.talk.walkerSaid(text, id)) { addLine('walker', text.trim()); walkLog.add('heard', { text }); }
      else if (text.trim()) walkLog?.add('ignored', { text });
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
function newWalk(withRoute) {
  const p = getProfile(profile());
  const lineVoice = { say: line => voice.say(line), utterance: () => voice.utterance(), cut: () => voice?.cut() }; // the real voice connects on Start
  return new Walk({
    voice: lineVoice, apiKey: settings.claudeKey(), model: settings.mindModel(), start, route: withRoute,
    profile: { likes: p.likes || [], landmarks: p.landmarks || [] },
    deps: {
      buildRoute, findNear, placesNear, surroundingTypes: SURROUNDING_TYPES, destinationOptions,
      saveLandmark: lm => { const n = saveLandmark(profile(), lm); showProfile(); return n; },
      updateLandmark: lm => { updateLandmark(profile(), lm); showProfile(); },
      saveInterest: i => saveInterest(profile(), i),
    },
    onOptions: found => showFound(found),
    onLandmark: () => refreshMarkers(),
    onHighlight: n => markChosen(n),
    onDestination: (dest, r) => {
      route = r;
      if (walkLog) walkLog.data.dest = dest;
      showRouteLine(r.line);
      setCheckpoints(r);
      foldMap();
      $('route-section').hidden = false;
      $('route-title').textContent = dest.name;
      $('route-summary').textContent = `${r.distance} m · about ${Math.max(1, Math.round(r.time / 60))} min`;
      for (const id of ['start-btn', 'fix-start-btn', 'start-picker', 'start-info', 'guide-check']) $(id).hidden = true;
      $('turns').innerHTML = '';
      $('back-btn').hidden = false;
    },
    log: (type, data) => { log(type, data ?? ''); walkLog?.add('event', { what: type, data }); },
    onLine: text => addLine('guide', text),
    // Before Start (the opener is written while the route is shown) a problem shows by the Start button.
    onNote: text => { addLine('note', text); if (walk !== prepared) { $('guide-check').textContent = text; $('guide-check').hidden = false; } },
    onRoute: r => {
      showRouteOnMap(r.line);
      walkLog?.add('route', { m: r.distance, turns: r.decisions.length });
      // On the way there the checkpoints follow the new route; on the way back they lead, so none.
      if (walk?.phase === 'back') setCheckpoints(null);
      else if (walk && walk.nav?.route === r) { showRouteLine(r.line); setCheckpoints(r, walk.nav.next); }
    },
    onPhase: ph => { showPhase(ph); addLine('note', '— heading back —'); walkLog?.add('phase', { phase: ph }); },
  });
}

function prepareWalk() {
  $('guide-check').hidden = true;
  if (!settings.claudeKey()) return;
  prepared = newWalk(route);
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
  foldMap();
  await voice.start(); // inside the tap, so iOS allows the microphone and audio
  walk.talk.release(); // the opener (written already) plays now
  callStarted();
}

// Talk first, pick where to go together: the call starts on the map, before any destination.
async function startCall() {
  if (route && prepared?.route0 === route) return startWalk(); // a place is already picked on the screen
  if (!settings.openaiKey()) return log('Enter the OpenAI API key in Settings (for the voice)');
  if (!settings.claudeKey()) return log('Enter the Claude API key in Settings (for what the guide says)');
  if (!start && !await findMe()) return;
  $('transcript').innerHTML = '';
  $('walk-section').hidden = false;
  $('talk-btn').hidden = true;
  $('back-btn').hidden = true; // no way back before there's a destination
  walkLog = new WalkLog({ profile: profile(), provider: 'openai+claude', model: `${settings.model()} / ${settings.mindModel()}`, voice: settings.voice(), start, dest: null });
  walk = newWalk(null);
  const same = preparedVoice && preparedVoice.model === settings.model() && preparedVoice.voice === settings.voice() && preparedVoice.apiKey === settings.openaiKey();
  voice = same ? preparedVoice : makeVoice();
  preparedVoice = null;
  showPhase('there');
  walk.plan({ ...start, accuracy: start.accuracy || 50 }, pastOpeners()); // the hello is written while the line connects
  await voice.start(); // inside the tap, so iOS allows the microphone and audio
  callStarted();
}

// Both ways into a call end here: follow GPS, keep the screen on.
async function callStarted() {
  walk.live();
  $('cp-check').hidden = false;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not critical */ }
  watchId = navigator.geolocation?.watchPosition(g => {
    const raw = { lat: g.coords.latitude, lng: g.coords.longitude, accuracy: g.coords.accuracy };
    walk.position(raw).catch(err => log('ERROR', err.message));
    const pos = walk.pos;
    walkLog.add('gps', { lat: pos.lat, lng: pos.lng, acc: Math.round(raw.accuracy), corrected: !!walk.nav?.correction });
    showMe(pos);
    showPosition(pos);
    // The card follows their next turn, unless they just flipped through it themselves.
    if (walk.nav && walk.phase === 'there' && checkpoints.length && cpIndex !== walk.nav.next && Date.now() - cpFlippedAt > 20000) showCheckpoint(walk.nav.next);
    $('nav-status').textContent = walk.nav ? walk.nav.status(walk.phase).replace('[status] ', '') : `Choosing where to go · GPS ±${Math.round(raw.accuracy)} m`;
  }, e => log('GPS error:', e.message), { enableHighAccuracy: true, maximumAge: 0 });
  costTimer = setInterval(() => walk && showPhase(walk.phase), 5000);
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
  walk?.close();
  walk = null;
  $('talk-btn').hidden = false;
  $('cp-check').hidden = true;
  $('home-map').hidden = false;
  $('map-btn').hidden = true;
  relayout();
  $('walk-section').hidden = true;
  $('route-section').hidden = false;
  showWalks();
  log('walk stopped and saved');
}

$('start-btn').onclick = () => startWalk().catch(err => log('ERROR', err.message));
$('talk-btn').onclick = () => startCall().catch(err => log('ERROR', err.message));
// A photo of something they like: kept on the phone, and the guide looks at it.
$('photo-btn').onclick = () => $('photo-input').click();
$('photo-input').onchange = async () => {
  const file = $('photo-input').files[0];
  $('photo-input').value = '';
  if (!file || !walk) return;
  try {
    const { blob, base64 } = await shrinkPhoto(file);
    const id = Date.now().toString(36);
    await savePhoto(profile(), id, blob);
    addLine('note', '(photo)');
    walk.photo(base64, id);
  } catch (err) { log('photo failed:', err.message); }
};
$('back-btn').onclick = () => headBack().catch(err => log('ERROR', err.message));
$('stop-btn').onclick = stopWalk;
$('search-form').addEventListener('submit', e => onSearch(e).catch(err => log('ERROR', err.message)));

setupSettings();
setupProfile();
loadKakao()
  .then(async () => {
    log('Kakao ready');
    // The map opens on where they are; without a location it shows central Seoul (only for looking).
    if (!await findMe()) ensureMap({ lat: 37.5729, lng: 127.0016 });
    refreshMarkers();
  })
  .catch(err => log('ERROR', err.message));
