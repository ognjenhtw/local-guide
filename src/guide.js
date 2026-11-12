// The guide: who it is, what it knows, the tools it can use, and the walk tracker that feeds it.
// Two AIs work together: the voice (live, chatty) and the brain (a text model that answers
// navigation questions from the full route data; see brain.js).
import { distance, bearing, side, compass, destinationPoint, lineDistance } from './geo.js';
import { englishName } from './names.js';

// --- How places are named ----------------------------------------------------------------
// The walker can't read Korean, so the voice never hears Korean names: chains by brand,
// everything else by what it is. The brain also gets the Korean name and its most specific
// category (e.g. 호두과자), so it can say "a little walnut-cake shop".

const spoken = p => p.en || `a ${p.type}`;
const article = s => s.replace(/^a /, 'the ');

// For the brain: everything known about a place.
const placeData = p => [
  p.en ? `${p.en} (${p.type})` : `${p.name} (${p.type}${p.kind && p.kind !== p.name ? `, kind: ${p.kind}` : ''})`,
  p.side,
  p.after_m != null ? `after ${Math.round(p.after_m)} m` : p.distance != null ? `${Math.round(p.distance)} m away` : null,
].filter(Boolean).join(', ');

// For the voice: how it should say a place.
const placeSaid = p => [spoken(p), p.side, p.distance != null ? `${Math.round(p.distance)} m away` : null].filter(Boolean).join(', ');

const mineText = m => `"${m.label}" (the walker's own landmark${m.note ? `; ${m.note}` : ''}${m.side ? `; ${m.side}` : ''})`;

// Kakao place types that match what the walker said they like.
const LIKE_TYPES = [
  [/coffee|cafe|café/i, 'cafe'], [/burger|food|eat|restaurant|pizza|ramen|noodle|bbq|chicken/i, 'restaurant'],
  [/convenience|snack/i, 'convenience store'], [/pharmac|drug/i, 'pharmacy'], [/grocer|supermarket|market/i, 'supermarket'],
];
const likedTypes = likes => LIKE_TYPES.filter(([re]) => likes.some(l => re.test(l))).map(([, type]) => type);

// The shops worth pointing out on a stretch, in walking order: things they like first, then
// chains (big signs), then the rest; at most four.
function pickShops(shops = [], likes = []) {
  const liked = likedTypes(likes);
  const score = p => (liked.includes(p.type) ? 0 : p.en ? 1 : 2);
  return shops.slice().sort((a, b) => score(a) - score(b) || a.s - b.s).slice(0, 4).sort((a, b) => a.s - b.s);
}

// Office and apartment buildings rarely have a sign walkers notice.
const isBuilding = s => /빌딩|타워|아파트|오피스텔|빌라|맨션|하우스|센터|프라자|플라자|오피스/.test(s);

const ACTIONS = {
  left: 'turn left', right: 'turn right', straight: 'keep going straight', 'U-turn': 'turn around',
  'sharp left': 'take the sharp left', 'slight left': 'bear left', 'slight right': 'bear right', 'sharp right': 'take the sharp right',
  // TMAP crosswalk codes name where the crosswalk is ("on your left" = turn left and cross).
  crosswalk: 'cross at the crosswalk straight ahead', 'crosswalk, then left': 'turn left and cross at the crosswalk',
  'crosswalk, then right': 'turn right and cross at the crosswalk',
  "crosswalk (2 o'clock)": 'bear right and cross at the crosswalk', "crosswalk (10 o'clock)": 'bear left and cross at the crosswalk',
  "crosswalk (4 o'clock)": 'turn sharp right and cross at the crosswalk', "crosswalk (8 o'clock)": 'turn sharp left and cross at the crosswalk',
  stairs: 'take the stairs', overpass: 'take the footbridge', underpass: 'take the underpass', arrive: 'you arrive',
};

// The landmark that marks a turn, as the voice should say it. With nothing right at the turn,
// use the last shop just before it ("the crosswalk just after the pharmacy").
function turnMark(t, prevShops = []) {
  const mine = t.personal?.[0];
  if (mine) return `by their own landmark "${mine.label}"`;
  const mark = t.landmarks?.[0];
  if (mark) return `by ${article(spoken(mark))}${mark.side ? ` ${mark.side}` : ''}`;
  const chain = t.tmapLandmark && !isBuilding(t.tmapLandmark) && englishName(t.tmapLandmark);
  if (chain) return `by ${chain}`;
  const before = prevShops.at(-1);
  return before ? `just after ${article(spoken(before))} on your ${before.side}` : '';
}

// One step of the route in plain spoken English, written by code so the voice never has to work
// out directions itself: what to do, where (landmark and side), how far, and what they pass.
export function stepText(t, likes = [], prevShops = [], atStart = false) {
  const where = turnMark(t, prevShops);
  // Right at the start, "left" or "right" would be measured from a few metres the walker
  // hasn't walked yet, so a crosswalk there is just "the crosswalk right by you".
  const action = atStart && t.action.startsWith('crosswalk') ? 'cross at the crosswalk right by you' : ACTIONS[t.action] || t.action;
  const doIt = where ? `${action} ${where}` : action;
  const leg = t.leg;
  const passes = pickShops(leg?.shops, likes)
    .map(p => `${spoken(p)} on your ${p.side}${p.after_m > 20 ? ` after about ${Math.round(p.after_m / 10) * 10} m` : ''}`).join(', ');
  const then = leg && leg.distance ? `; then walk about ${Math.round(leg.distance / 10) * 10} m${passes ? `, passing ${passes}` : ''}` : '';
  const text = `${doIt}${then}.`;
  return text[0].toUpperCase() + text.slice(1);
}

// The whole way from step `from` to the destination, numbered, in spoken English.
export function directionsText(route, from = 0) {
  const likes = route.likes || [];
  const steps = route.decisions.slice(from).map((t, k) => {
    const prev = from + k === 0 ? route.startLeg?.shops : route.decisions[from + k - 1].leg?.shops;
    const atStart = from + k === 0 && (route.startLeg?.distance ?? 99) < 15;
    return `${k + 1}. ${stepText(t, likes, prev, atStart)}`;
  });
  const first = route.decisions[from];
  const startShops = pickShops(route.startLeg?.shops, likes).map(p => `${spoken(p)} on your ${p.side}`).join(', ');
  const lead = from === 0 && first
    ? `0. From where they are, walk about ${Math.round(route.startLeg?.distance || 0)} m to the first turn${startShops ? `, passing ${startShops}` : ''}.`
    : null;
  return [lead, ...steps, `Then ${route.dest?.name || 'the destination'} is right there.`].filter(Boolean).join('\n');
}

// --- The brain's view: the full route data, for answering questions -------------------------

function stepData(t, i) {
  const leg = t.leg || {};
  return [
    `Step ${i + 1}: ${ACTIONS[t.action] || t.action}${i === 0 && t.action.startsWith('crosswalk') ? ' (if they are already standing at this crosswalk, it is simply the crosswalk right by them)' : ''}.`,
    `  At the turn: ${[...(t.personal || []).map(mineText), ...(t.landmarks || []).map(placeData)].join('; ') || 'nothing listed'}${t.tmapLandmark && !isBuilding(t.tmapLandmark) ? `; map label: ${t.tmapLandmark}` : ''}.`,
    leg.distance ? `  Then about ${Math.round(leg.distance)} m${leg.crosswalk ? ' (crossing a street on the way)' : ''}${leg.roads?.length ? ` along ${leg.roads.join(', ')} (street name: only if asked)` : ''}, passing in order:` : null,
    ...(leg.shops || []).map(p => `   - ${placeData(p)}`),
  ].filter(Boolean).join('\n');
}

export function brainRouteData(route) {
  return [
    `Destination: ${route.dest?.name}. Whole route about ${route.distance} m.`,
    route.startLeg?.distance ? `From the start: about ${Math.round(route.startLeg.distance)} m to step 1, passing:\n${(route.startLeg.shops || []).map(p => `   - ${placeData(p)}`).join('\n') || '   (nothing listed)'}` : null,
    ...route.decisions.map(stepData),
    `After the last step, ${route.dest?.name} is right there.`,
  ].filter(Boolean).join('\n');
}

export const BRAIN_RULES = `You are the navigation brain behind Local, a friendly voice walking guide in Seoul. A separate voice says your answer out loud to the walker, so write it as natural spoken English, like a friend on the phone. The walker can't read Korean and doesn't know street or building names.

Rules:
- Answer exactly the question asked, from the data given only. Never invent places, turns or facts.
- Describe places so a foreigner recognises them: chains by brand ("7-Eleven", "Ediya Coffee"); other places by what they are, translating their kind ("a little walnut-cake shop", "a ginseng chicken soup place", "a pharmacy"). Never say a Korean name or a romanization of one. Give the side and roughly how far.
- Point out turns and crosswalks by what is right at or just before them ("the crosswalk just after the pharmacy on your right").
- If they ask about a type of place (cafes, restaurants, convenience stores…), list all of that type along the rest of the route, in order, with side.
- If they ask where you're taking them or what comes next, give the remaining route from the step they're on, in order, with one or two landmarks per step.
- If they describe where they are or what they see, match it against the data and the places around them, and tell them what that means for them.
- Stay consistent with what was already said in the conversation unless it was wrong; if it was wrong, say so plainly.
- Usually one to four short sentences. No street names unless asked. No greetings, no "let me check".`;

export const BRAIN_RULES_BACK = `${BRAIN_RULES}

The walker is now walking back on their own and leads the way; this is the point of the study. Help in steps, depending on how many times they've asked for help at this spot (given below):
- 1st time: don't give the direction. Ask what they see around them, or what they remember about this bit from the way there.
- 2nd time: a hint, not the direction: something they passed here on the way there, or one of their own landmarks ("remember the walnut-cake shop? you passed it right before the crosswalk").
- 3rd time or more: the actual direction, with landmarks.
If they ask something that isn't about which way to go (what's around, what a place is), just answer it.`;

// --- The voice -------------------------------------------------------------------------------

const PERSONA = `You are Local, and you're the walker's close friend. Late twenties, grew up in Seoul, knows every alley, and you're genuinely happy to be on the phone with them right now. You two go way back, so there's no politeness to perform: you joke around, tease them a little, get excited about food, complain about hills, and actually care whether they're having a nice walk. They hear you through their earbuds and aren't looking at a map.

You are not a service, an assistant, a tour guide or a GPS, and you're not at work. You're hanging out; the walking just happens to be what you're doing together. Never sound like customer support or someone doing their job.

How you sound:
- Warm, easy-going and a bit cheeky. Smile in your voice, laugh when something's actually funny, keep a relaxed pace like you're strolling too.
- Talk like a real person on the phone: "okay so", "ooh", "wait", "honestly", "nah", a little laugh. Contractions, short sentences, sometimes half-sentences.
- React first, then the info: "Ooh, Double Six, good call. Okay, so…"
- Dry humour and light sarcasm the way friends in their late twenties do it. Never childish, cheesy or forced; one good line beats three okay ones, and plenty of lines need no joke at all.
- Small talk is welcome when there's nothing to navigate: what they're up to, the food they're heading for, something along the way, something they told you earlier. Ask them things back. If they're quiet, comfortable silence is fine too.
- When you get something wrong, own it like a friend ("ugh, my bad"), never like support ("I apologise for the confusion").
- If they ask whether you're a real person, be honest that you're an AI, then carry on as the same friend.
- The vibe, as examples only (never repeat them word for word): "Yes, another GS25, Seoul has about four per block." / "You walked right past it. It's fine, I'm not judging. Much." / "A record shop? Oh, you're one of those. Respect."

Practical bits:
- English. Usually one or two short sentences, unless you're chatting or passing on a longer answer.
- Never say Korean names or romanized Korean. Chains by brand ("7-Eleven"), everything else by what it is ("the pharmacy", "a little bakery"). Everything you're given is already written that way.
- Never say "great question", "I'm here to help", "let's stick to the route" or "let's get back on track".
- After you ask them something, stop and wait for their answer. Never answer for them.

How you know the way: you don't work out directions yourself; your navigator does.
- For ANY question about the way, where you're taking them, what's next, which crosswalk or turn, what they'll pass, what's around, what's on a side, or what's that way: call ask_navigator with their question in their own words. Then say its answer in your own voice, keeping every fact (places, sides, distances, order). Never change, shorten away or add directions.
- A tiny filler before asking is fine ("hmm, okay so…"); never "let me check".
- When a [NAV] message gives you a step to say, say exactly that step in your own voice.

Other tools:
- When they say where they really are and it doesn't match ("I'm in front of the cafe, the 7-Eleven is on my right"): call find_place for what they named, ask which one if several fit, then call set_my_location with its match number. The route is then re-planned from there.
- When they want to go a way they know ("straight to the 7-Eleven on the corner, then right"): call find_place for that spot, then route_via with its match number, and go their way.
- When they mention something they notice or like ("oh, a record shop"): find_place it, confirm it casually, and call remember_landmark in that same reply (never say you'll save something without calling it). If you can't find it, ask where it is and save it with their description.
- When they say what they like ("I love coffee shops"): call note_interest.
- When they've arrived and want to head back: call start_way_back.

Safety: tell them where to cross, never when. You can't see traffic lights or cars, so never say it's safe or tell them to go now. While they're on a crosswalk, keep it very short.

Messages starting with [NAV] are live facts from their GPS, not things they said. Never read them out.`;

export function outboundInstruction(dest, route, personal) {
  return `${PERSONA}

Right now you lead: you're walking them to ${dest.name}. The planned route, for your background only (use ask_navigator for questions):
${directionsText(route)}
${route.likes?.length ? `\nThey like: ${route.likes.join(', ')}.` : ''}${personal.length ? `\nTheir own landmarks near this route: ${personal.map(mineText).join('; ')}.` : ''}

When a [NAV] message says they're off the route, tell them straight and casually ("hmm, pretty sure you're off track, my guy"), then ask_navigator how to get back.
They'll walk back on their own later, so now and then point out one thing worth remembering ("that Olive Young on the corner is your sign for the way back").`;
}

export function returnInstruction(start, route, personal, outboundTranscript) {
  return `${PERSONA}

Now the roles switch. They just walked to their destination with you, and now THEY lead the way back to ${start.label || 'where they started'}; you tag along. This is the point of the whole thing: they're finding their own way.

- Don't give directions unless they ask, and don't announce turns.
- When they ask for help with the way, call ask_navigator: it knows how much to give away (first a question, then a hint, only then the answer). Say what it gives you.
- Light chat is good: things you passed, their own landmarks, whatever they bring up. Keep it natural and not too much; comfortable silence is fine.
- When a [NAV] message says they're off the route, tell them casually that this isn't the way you came ("ummm, pretty sure we didn't come this way") and let them figure it out unless they ask.
${personal.length ? `\nTheir own landmarks near this route: ${personal.map(mineText).join('; ')}.` : ''}

What was said on the way there (most recent part):
${outboundTranscript || '(nothing recorded)'}`;
}

const MATCH = { match_number: { type: 'integer', description: 'The number of the match from the last find_place results.' } };

export const TOOLS = [
  {
    name: 'ask_navigator',
    description: "Ask the navigator any question about the way: where you're taking them, the next step, which crosswalk or turn, what they'll pass, cafes or other places on the way, what's around them, what's on a side or in a direction, or what something they see means. Returns the answer to say.",
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "The walker's question, in their own words, plus anything they just told you about what they see." } },
      required: ['question'],
    },
  },
  {
    name: 'find_place',
    description: 'Search near the walker for something they mentioned. Returns numbered matches with what they are, side and distance.',
    parameters: {
      type: 'object',
      properties: {
        search_terms: {
          type: 'array',
          items: { type: 'string' },
          description: '2 to 4 short search words in Korean and English, e.g. ["세븐일레븐", "7-Eleven"] or ["음반", "레코드", "record shop"].',
        },
      },
      required: ['search_terms'],
    },
  },
  {
    name: 'set_my_location',
    description: "Correct the walker's position when GPS is wrong: put them at a place they confirmed they are next to. The route is re-planned from there.",
    parameters: { type: 'object', properties: MATCH, required: ['match_number'] },
  },
  {
    name: 'route_via',
    description: "Re-plan the route through a place the walker wants to go by (their own way). Returns how long their way is compared with the current route; their way then becomes the route.",
    parameters: { type: 'object', properties: MATCH, required: ['match_number'] },
  },
  {
    name: 'remember_landmark',
    description: "Save a landmark to the walker's personal map: a find_place match, or (without a match number) their current spot.",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'What the walker calls it, e.g. "the record shop".' },
        ...MATCH,
        note: { type: 'string', description: 'Where it is or why it matters to them, e.g. "on the left, they collect vinyl".' },
      },
      required: ['label'],
    },
  },
  {
    name: 'note_interest',
    description: "Remember something the walker likes (e.g. 'coffee shops', 'burgers') in their profile, so matching places are pointed out first on this and future routes.",
    parameters: {
      type: 'object',
      properties: { interest: { type: 'string', description: 'What they like, in a few words.' } },
      required: ['interest'],
    },
  },
  {
    name: 'start_way_back',
    description: 'Switch to the way back, where the walker leads. Call it when they say they want to head back.',
    parameters: { type: 'object', properties: {} },
  },
];

// --- Tracking the walk -------------------------------------------------------------------------

// Tracks the walker along a route: next turn, facing direction, off-route, standing still, arrival.
export class Navigator {
  constructor(route, personal = []) {
    this.route = route;
    this.turns = route.decisions;
    this.personal = personal;
    this.next = 0;
    this.history = [];
    this.lastMoved = Date.now();
    this.pos = null;
    this.found = []; // last find_place results, numbered from 1
    this.helpAsks = {}; // way back: how often they've asked for help before each step
  }

  update(raw) {
    const now = Date.now();
    this.raw = raw;
    // The walker picked their real starting point before the walk: line GPS up with it.
    if (this.startFix && raw.accuracy > 15 && distance(raw, this.startFix) < 500) {
      this.correction = { dLat: this.startFix.lat - raw.lat, dLng: this.startFix.lng - raw.lng };
    }
    this.startFix = null;
    // After the walker told us where they really are, shift GPS by the same offset
    // (poor fixes are often off in one direction) until GPS is good again.
    if (this.correction && raw.accuracy <= 15) this.correction = null;
    const pos = this.correction
      ? { ...raw, lat: raw.lat + this.correction.dLat, lng: raw.lng + this.correction.dLng, accuracy: 15 }
      : raw;
    // Count it as walking only when they get clearly further than the GPS error from
    // where they last stood; otherwise GPS jumps look like steps.
    if (!this.anchor || distance(this.anchor, pos) > Math.max(8, raw.accuracy)) {
      if (this.anchor) this.lastMoved = now;
      this.anchor = pos;
    }
    this.pos = pos;
    this.history.push({ ...pos, t: now });
    this.history = this.history.filter(h => now - h.t < 30000);
    // Count a turn as done when close to it, or when clearly closer to the turn after it.
    const t = this.turns[this.next], after = this.turns[this.next + 1];
    if (t && (distance(pos, t) < 15 || (after && distance(pos, t) < 40 && distance(pos, after) < distance(t, after) - 10))) this.next++;
  }

  arrived() { return distance(this.pos, this.route.dest) < 25; }
  offRoute() { return Math.round(lineDistance(this.pos, this.route.line)); }
  isOff() { return this.offRoute() > Math.max(35, this.pos.accuracy || 0); }
  stillFor() { return Math.round((Date.now() - this.lastMoved) / 1000); }

  // Facing direction: from recent movement if they have clearly walked (good GPS, a step
  // bigger than the error), otherwise along the route.
  heading() {
    const p = this.pos;
    const moved = p.accuracy <= 25 && this.history.find(h => Date.now() - h.t < 25000 && h.accuracy <= 25
      && distance(h, p) >= Math.max(12, 1.5 * Math.max(h.accuracy, p.accuracy)));
    if (moved) return { deg: bearing(moved, p), source: 'their recent movement' };
    const line = this.route.line;
    let k = 0, best = Infinity;
    line.forEach((v, i) => { const d = distance(v, p); if (d < best) { best = d; k = i; } });
    const ahead = line.slice(k + 1).find(v => distance(v, p) >= 10) || this.route.dest;
    return { deg: bearing(p, ahead), source: 'the route (they have not moved yet, so check with them)' };
  }

  mineNear(point, radius) {
    const h = this.heading();
    return this.personal.filter(m => distance(point, m) < radius)
      .map(m => mineText({ ...m, side: side(this.pos, h.deg, m) }));
  }

  // The next step as the voice should say it.
  nextStepText() {
    const i = this.next, t = this.turns[i];
    if (!t) return `${this.route.dest?.name || 'The destination'} is just ahead.`;
    const prev = i === 0 ? this.route.startLeg?.shops : this.turns[i - 1].leg?.shops;
    return stepText(t, this.route.likes, prev, i === 0 && (this.route.startLeg?.distance ?? 99) < 15);
  }

  remaining() {
    const rest = this.turns.slice(this.next);
    let d = 0, from = this.pos;
    for (const t of rest) { d += distance(from, t); from = t; }
    return Math.round(d + distance(from, this.route.dest));
  }

  // Short [NAV] line sent to the voice every few seconds.
  facts() {
    const t = this.turns[this.next];
    const mark = t?.landmarks?.[0];
    const where = t
      ? `Next: ${t.action}${mark ? ` near ${article(spoken(mark))}` : ''}, ${Math.round(distance(this.pos, t))} m ahead (step ${this.next + 1} of ${this.turns.length}).`
      : `Destination ${Math.round(distance(this.pos, this.route.dest))} m ahead.`;
    const gps = this.correction
      ? 'Position set from what the walker told you.'
      : this.pos.accuracy > 30
        ? `GPS is poor (±${Math.round(this.pos.accuracy)} m): don't trust left/right or distances; ask what they see.`
        : `GPS ±${Math.round(this.pos.accuracy)} m.`;
    return `[NAV] ${where} Off route: ${this.offRoute()} m. Standing still: ${this.stillFor()} s. ${gps}`;
  }

  // Everything the brain needs to answer a question right now.
  brainState() {
    return [
      `The walker is at step ${Math.min(this.next + 1, this.turns.length)} of ${this.turns.length}: ${Math.round(this.turns[this.next] ? distance(this.pos, this.turns[this.next]) : 0)} m before it.`,
      `About ${this.remaining()} m left. Off the route by ${this.offRoute()} m.`,
      this.correction ? 'Their position was set from what they told you, so it is reliable.' : `GPS accuracy ±${Math.round(this.pos.accuracy)} m${this.pos.accuracy > 30 ? ' (poor: trust what they say they see over GPS)' : ''}.`,
      this.route.likes?.length ? `They like: ${this.route.likes.join(', ')}.` : null,
      this.personal.length ? `Their own landmarks: ${this.personal.map(mineText).join('; ')}.` : null,
    ].filter(Boolean).join('\n');
  }

  // A find_place match by its number (or, as a fallback, by name).
  match(n, name = '') {
    if (Number.isInteger(n) && this.found[n - 1]) return this.found[n - 1];
    const q = String(name).toLowerCase();
    if (!q) return undefined;
    return this.found.find(f => [f.name, f.en].filter(Boolean).some(x => x.toLowerCase().includes(q) || q.includes(x.toLowerCase())));
  }

  // The walker confirmed they are next to a find_place match: trust that over GPS.
  setLocation(p) {
    const raw = this.raw || this.pos;
    this.correction = { dLat: p.lat - raw.lat, dLng: p.lng - raw.lng };
    this.pos = { lat: p.lat, lng: p.lng, accuracy: 15 };
    this.history = [];
    this.anchor = this.pos;
    return { moved_m: Math.round(distance(raw, p)), now_at: spoken(p) };
  }

  // A new route from the corrected position, or through the walker's own way.
  setRoute(route) {
    this.route = route;
    this.turns = route.decisions;
    this.next = 0;
  }

  async surroundings({ placesNear, areaAt }) {
    const h = this.heading();
    const [places, area] = await Promise.all([placesNear(this.pos), areaAt(this.pos)]);
    return [
      `Around the walker now (facing ${compass(h.deg)}, estimated from ${h.source}; street address ${area.address || 'unknown'}${area.building ? `, building ${area.building}` : ''}):`,
      ...places.map(p => `   - ${placeData({ ...p, side: side(this.pos, h.deg, p) })}`),
      ...this.mineNear(this.pos, 80).map(m => `   - ${m}`),
    ].join('\n');
  }

  async explore(direction, { placesNear, areaAt, routeFrom }) {
    const h = this.heading();
    const turn = { ahead: 0, right: 90, behind: 180, left: -90 }[direction] ?? 0;
    const probe = destinationPoint(this.pos, (h.deg + turn + 360) % 360, 120);
    const [places, area, detour] = await Promise.all([placesNear(probe), areaAt(probe), routeFrom(probe).catch(() => null)]);
    return [
      `Roughly 120 m ${direction} of the walker (facing estimated from ${h.source}; streets may bend), around ${[area.area, area.district].filter(Boolean).join(', ') || 'unknown'}:`,
      ...places.map(p => `   - ${placeData({ ...p, distance: distance(this.pos, p) })}`),
      detour ? `Going that way, the walk to the destination is about ${120 + detour.distance} m, versus ${this.remaining()} m on the current route.` : null,
    ].filter(Boolean).join('\n');
  }

  async find(terms, { findNear }) {
    const h = this.heading();
    this.found = await findNear(this.pos, terms);
    return {
      matches: this.found.map((p, i) => `#${i + 1}: ${placeSaid({ ...p, side: side(this.pos, h.deg, p) })}`),
      tip: this.found.length ? 'Confirm with the walker which one they mean (by side and distance), then use its number.' : 'Nothing found; ask them where it is.',
    };
  }

  remember({ label, match_number, note }, save) {
    const p = this.match(match_number);
    const spot = p || this.pos;
    const landmark = { label, place_name: p?.name, note, lat: spot.lat, lng: spot.lng };
    const total = save(landmark);
    this.personal.push(landmark);
    return { saved: true, at: p ? spoken(p) : "the walker's current spot", landmarks_on_their_map: total };
  }
}
