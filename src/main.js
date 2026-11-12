import { log } from './log.js';
import { loadKakao, searchPlaces, placesNear, findNear, areaAt, LANDMARK_TYPES, SURROUNDING_TYPES } from './kakao.js';
import { walkingRoute } from './tmap.js';
import { PROVIDERS, createSession } from './providers/index.js';
import { outboundInstruction, returnInstruction, Navigator, TOOLS, directionsText, brainRouteData, BRAIN_RULES, BRAIN_RULES_BACK } from './guide.js';
import { BRAINS, askBrain } from './brain.js';
import { side, distance, lineDistance, project, pointsAlong } from './geo.js';
import { profileNames, getProfile, saveLandmark, saveInterest, WalkLog, exportWalks, walksOf, deleteWalk, transcriptOf } from './profile.js';
import { showPosition, showRoute as showRouteOnMap } from './debugmap.js';

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
  // The brain: which text AI answers navigation questions.
  $('brain').innerHTML = Object.entries(BRAINS).map(([id, b]) => `<option value="${id}">${b.label}</option>`).join('');
  // Claude when its key is there (fast and reliable), otherwise Gemini's free tier.
  $('brain').value = store.get('brain', store.get('claudeKey') || import.meta.env.VITE_ANTHROPIC_API_KEY ? 'claude' : 'gemini');
  const refreshBrain = () => fillOptions($('brain-model'), BRAINS[$('brain').value].models, store.get(`brainModel.${$('brain').value}`));
  refreshBrain();
  $('brain').onchange = () => { store.set('brain', $('brain').value); refreshBrain(); };
  $('brain-model').onchange = () => store.set(`brainModel.${$('brain').value}`, $('brain-model').value);
  $('key-claude').value = store.get('claudeKey', import.meta.env.VITE_ANTHROPIC_API_KEY || '');
  $('key-claude').onchange = () => store.set('claudeKey', $('key-claude').value.trim());
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

// Run async tasks with at most `n` at a time (Kakao limits how fast we may ask).
async function pool(tasks, n) {
  const it = tasks[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => { for (const task of it) await task(); }));
}

// Shops people notice, looked up every ~60 m along the whole route, in walking order with their side.
const ALONG_TYPES = ['CE7', 'CS2', 'FD6', 'PM9', 'BK9', 'SW8', 'MT1'];
async function shopsAlong(route) {
  const found = new Map();
  await pool(pointsAlong(route.line, 60).flatMap(pt => ALONG_TYPES.map(code => async () => {
    for (const p of await placesNear(pt, 35, [code], 15)) if (!found.has(p.name)) found.set(p.name, p);
  })), 6);
  return [...found.values()]
    .map(p => ({ ...p, ...project(route.line, p) }))
    .filter(p => p.off < 30)
    .sort((a, b) => a.s - b.s);
}

// A walking route with landmarks: at each turn up to three places described from where the
// walker arrives, the shops along each stretch, and any of the walker's own landmarks close by.
async function buildRoute(from, to, personal, via = []) {
  const route = await walkingRoute(from, to, via);
  route.dest = to;
  route.likes = getProfile(profile()).likes || [];
  route.personal = personal.filter(m => lineDistance(m, route.line) < 50);
  // Hand each stretch the shops that lie along it.
  const shops = await shopsAlong(route);
  const cuts = route.decisions.map(t => project(route.line, t).s);
  const between = (from, to) => shops.filter(p => p.s >= from && p.s < to).map(p => ({ ...p, after_m: Math.round(p.s - from) }));
  if (route.startLeg) route.startLeg.shops = between(0, cuts[0] ?? Infinity);
  route.decisions.forEach((t, i) => { if (t.leg) t.leg.shops = between(cuts[i], cuts[i + 1] ?? Infinity); });
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
  // Check the start: a route planned from the wrong spot is wrong from the first turn.
  const near = await placesNear(start, 40, SURROUNDING_TYPES, 2);
  $('start-info').textContent = start.fixed
    ? `Starting at ${start.label} (you picked it)`
    : `Starting near ${near.map(p => p.name).join(', ') || 'an unnamed spot'} · GPS ±${Math.round(start.accuracy || 0)} m`;
  $('start-picker').hidden = true;
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

// Phrases that mean "you have my position or direction wrong". The code catches them itself
// so the guide is told to re-locate instead of repeating itself.
const CORRECTION = new RegExp([
  String.raw`\bgps\b`, 'wrong (way|direction)', 'opposite (way|direction)', 'not where i am',
  // "I'm in front of", "I'm right in front of", "I'm actually at", "I am standing next to"…
  String.raw`\bi('| a)?m\s+(right\s+|just\s+|actually\s+|already\s+|standing\s+|now\s+)*(in front of|next to|by|at|outside|near|beside)\b`,
  'where are you taking me', 'do you (even |really )?(know|understand|hear)', String.raw`you('| a)?re wrong`, String.raw`that'?s wrong`,
  'same page', 'are you (dumb|listening)', 'listen to me',
].join('|'), 'i');
let lastNudge = 0, walkerLine = '';

function checkForCorrection(text) {
  walkerLine += text;
  if (!CORRECTION.test(walkerLine) || Date.now() - lastNudge < 20000) return;
  lastNudge = Date.now();
  walkLog?.add('nudge', { text: walkerLine });
  session?.sendFacts("[NAV] The walker is pushing back. Do not repeat your last instruction. If they told you where they are, call find_place and then set_my_location; if they want to go a way they know, call find_place and then route_via; otherwise pass their exact question to ask_navigator and say its answer.", false);
}

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
  if (who === 'walker') checkForCorrection(text); else walkerLine = '';
  walkLog?.add('say', { who, text });
}

// --- The navigator brain -------------------------------------------------------------------

const DIRECTION_WORDS = [[/\bleft\b/i, 'left'], [/\bright\b(?! (now|here|there|away))/i, 'right'], [/\b(behind|back|other way|opposite)\b/i, 'behind'], [/\b(ahead|straight|forward)\b/i, 'ahead']];

// A question for the brain, with everything it needs: the whole route, where the walker is,
// what's around them, what's in a direction they asked about, and the recent conversation.
async function askNavigator(question) {
  const deps = { placesNear: pos => placesNear(pos, 60, SURROUNDING_TYPES, 12), areaAt, routeFrom: pos => walkingRoute(pos, nav.route.dest) };
  const dir = DIRECTION_WORDS.find(([re]) => re.test(question))?.[1];
  const [around, that] = await Promise.all([
    nav.surroundings(deps).catch(() => ''),
    dir && /what|where|if|happen|over there|side/i.test(question)
      ? nav.explore(dir, { ...deps, placesNear: p => placesNear(p, 70, SURROUNDING_TYPES, 8) }).catch(() => '')
      : '',
  ]);
  const step = nav.next;
  if (phase === 'back') nav.helpAsks[step] = (nav.helpAsks[step] || 0) + 1;
  const recent = transcript.filter(t => t.who !== 'note').slice(-12)
    .map(t => `${t.who === 'guide' ? 'Local' : 'Walker'}: ${t.text.trim()}`).join('\n');
  const prompt = [
    'WHERE THE WALKER IS', nav.brainState(), around, that,
    phase === 'back' ? `\nThis is help request number ${nav.helpAsks[step]} at this spot.` : '',
    '\nTHE CONVERSATION SO FAR', recent || '(just started)',
    `\nTHE WALKER ASKS: "${question}"`,
  ].filter(Boolean).join('\n');
  const brain = $('brain').value;
  const t0 = Date.now();
  try {
    const answer = await askBrain({
      provider: brain,
      model: $('brain-model').value,
      apiKey: brain === 'claude' ? $('key-claude').value.trim() : $('key-gemini').value.trim(),
      system: phase === 'back' ? BRAIN_RULES_BACK : BRAIN_RULES,
      context: `THE ROUTE\n${brainRouteData(nav.route)}`,
      prompt,
    });
    log(`navigator answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { answer, note: 'Say this in your own voice, keeping every fact.' };
  } catch (err) {
    // Too slow or failed: never leave the walker hanging. Fall back to the next step from the route data.
    log('navigator failed:', err.message);
    walkLog.add('brain_failed', { error: err.message, ms: Date.now() - t0 });
    return phase === 'back'
      ? { answer: 'Ask them what they see around them right now, or what they remember about this bit.', note: 'The navigator was too slow; this is a fallback.' }
      : { answer: nav.nextStepText(), note: 'The navigator was too slow; this is the next step from the route data. Say it, and offer to go through the rest.' };
  }
}

function toolHandler(name, args) {
  const deps = {
    findNear: (pos, terms) => findNear(pos, terms, 300, 8), // wide, so different branches of a chain can be told apart
  };
  const run = {
    ask_navigator: () => askNavigator(args.question || ''),
    find_place: () => nav.find(args.search_terms || [], deps),
    remember_landmark: () => {
      const r = nav.remember(args, lm => saveLandmark(profile(), lm));
      showProfile();
      return r;
    },
    set_my_location: async () => {
      const p = nav.match(args.match_number, args.place_name);
      if (!p) return { error: 'No such match. Call find_place first, then use the number of the match they confirmed.' };
      const r = nav.setLocation(p);
      showPosition(nav.pos);
      // Always plan again from where they really are: even a few metres off, the first step of
      // a route planned from the wrong spot ("turn right by the restaurant") makes no sense.
      const fresh = await buildRoute(nav.pos, nav.route.dest, getProfile(profile()).landmarks);
      nav.setRoute(fresh);
      showRouteOnMap(fresh.line);
      r.route_replanned = true;
      r.first_step = phase === 'there' ? nav.nextStepText() : '(way back: still only help when asked)';
      r.note = 'Say the first step from here in your own voice. For anything after that, use ask_navigator.';
      return r;
    },
    note_interest: () => {
      const likes = saveInterest(profile(), args.interest);
      nav.route.likes = likes; // directions from now on point out these first
      return { saved: true, their_interests: likes, note: 'Directions now list matching places first.' };
    },
    route_via: async () => {
      const via = nav.match(args.match_number, args.place_name);
      if (!via) return { error: 'No such match. Call find_place for the spot they mean first, then use its number.' };
      // Going "via" the shop they're standing next to changes nothing; they almost surely meant another one.
      if (distance(nav.pos, via) < 40) {
        return { error: `That one is right next to them (${Math.round(distance(nav.pos, via))} m), so it can't be the place further along they mean. Look at the other matches (side, distance) and pick the one that fits what they described.` };
      }
      const before = nav.remaining();
      const theirs = await buildRoute(nav.pos, nav.route.dest, getProfile(profile()).landmarks, [via]);
      nav.setRoute(theirs);
      showRouteOnMap(theirs.line);
      return {
        their_way_m: theirs.distance,
        previous_route_m: before,
        first_step: phase === 'there' ? nav.nextStepText() : '(way back: still only help when asked)',
        note: 'Their way is the route now. Say how it compares and the first step; for anything after that, use ask_navigator.',
      };
    },
    start_way_back: () => {
      if (phase !== 'there') return { note: 'Already on the way back.' };
      // Give the guide a moment to say its line before the switch.
      setTimeout(() => headBack().catch(err => log('ERROR', err.message)), 3000);
      return { switching: true, note: 'Say one short line; in a moment you switch to the way back.' };
    },
  }[name];
  const result = Promise.resolve(run ? run() : { error: `unknown tool ${name}` });
  result.then(r => { log(`tool ${name}`, r); walkLog.add('tool', { name, args, result: r }); });
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
    walkLog.add('gps', { lat: nav.pos.lat, lng: nav.pos.lng, acc: Math.round(p.coords.accuracy), corrected: !!nav.correction });
    showPosition(nav.pos);
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
      session.sendFacts(`[NAV] The next step is coming up. Say it now in your own voice, keeping every fact: ${nav.nextStepText()}`, true);
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
  if (start.fixed) nav.startFix = start; // the walker picked their real start: line GPS up with it
  showPosition(nav.pos);
  showRouteOnMap(route.line);

  session = await openSession(outboundInstruction(route.dest, route, route.personal));
  // Check where they are before the first direction: a route from the wrong spot is wrong from turn one.
  session.sendFacts(start.fixed
    ? `[NAV] The walker is ready at the start, which they confirmed themselves. Say hi like a friend picking up the phone, then give the first step: ${nav.nextStepText()}`
    : '[NAV] The walker is ready at the start, but GPS may be off. Say hi like a friend picking up the phone, then ask what they see around them right now (a shop or two) and wait. When they answer, if it fits the start, give the first step via ask_navigator; if it does not, use find_place and set_my_location first.', true);
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

  const here = nav.pos, raw = nav.raw || nav.pos; // corrected position for the route, raw GPS for the tracker
  const backRoute = await buildRoute(here, { ...start, name: start.label }, getProfile(profile()).landmarks);
  walkLog.add('phase', { phase: 'back', route_m: backRoute.distance });
  const correction = nav.correction;
  nav = new Navigator(backRoute, backRoute.personal.slice());
  nav.correction = correction; // keep the walker's own position fix
  nav.update(raw);
  showRouteOnMap(backRoute.line);

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
