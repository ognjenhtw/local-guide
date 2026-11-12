// The guide: who it is, what it knows, the tools it can use, and the walk tracker that feeds it.
import { distance, bearing, side, compass, destinationPoint, lineDistance } from './geo.js';
import { romanize, englishName } from './names.js';

// Chains by their English name; other places by their Korean name plus how it reads.
const placeText = p => [
  p.en && p.en !== p.name ? `${p.en} [${p.name}] (${p.type})`
    : p.reads && p.reads !== p.name ? `${p.name} [reads "${p.reads}"] (${p.type})` : `${p.name} (${p.type})`,
  p.street ? `at ${p.street}` : null,
  p.side,
  p.distance != null ? `${Math.round(p.distance)} m away` : null,
].filter(Boolean).join(', ');

const mineText = m => `"${m.label}" (the walker's own landmark${m.place_name ? `: ${m.place_name}` : ''}${m.note ? `; ${m.note}` : ''}${m.side ? `; ${m.side}` : ''})`;

export function turnSummary(t, i, likes = []) {
  const marks = [...(t.personal || []).map(mineText), ...(t.landmarks || []).map(placeText)];
  return `${i + 1}. ${stepText(t, likes)} [all landmarks at the turn: ${marks.length ? marks.join('; ') : t.tmapLandmark || 'nothing listed'}]`;
}

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

const shopName = p => (p.en ? p.en : `${p.name} [reads "${p.reads}"]`);
const passingText = (shops, likes) => pickShops(shops, likes)
  .map(p => `${shopName(p)} (${p.type}) on your ${p.side}${p.after_m > 20 ? ` after about ${Math.round(p.after_m / 10) * 10} m` : ''}`)
  .join(', ');

// Korean names as the walker would hear them said: "다산로" -> "Dasanro".
const say = s => (s ? romanize(s) : s);
// Office and apartment buildings rarely have a sign walkers notice.
const isBuilding = s => /빌딩|타워|아파트|오피스텔|빌라|맨션|하우스|센터|프라자|플라자|오피스/.test(s);
// A name from TMAP: English for chains ("Hana Bank (Seogyodong branch)"), otherwise Korean plus its reading.
const tmapName = s => englishName(s) || `${s} [reads "${say(s)}"]`;

const ACTIONS = {
  left: 'turn left', right: 'turn right', straight: 'keep going straight', 'U-turn': 'turn around',
  'sharp left': 'take the sharp left', 'slight left': 'bear left', 'slight right': 'bear right', 'sharp right': 'take the sharp right',
  crosswalk: 'cross the street at the crosswalk', 'crosswalk, then left': 'cross the street at the crosswalk, and on the other side turn left',
  'crosswalk, then right': 'cross the street at the crosswalk, and on the other side turn right',
  "crosswalk (2 o'clock)": 'cross the street at the crosswalk, and on the other side bear right', "crosswalk (10 o'clock)": 'cross the street at the crosswalk, and on the other side bear left',
  "crosswalk (4 o'clock)": 'cross the street at the crosswalk, and on the other side turn sharp right', "crosswalk (8 o'clock)": 'cross the street at the crosswalk, and on the other side turn sharp left',
  stairs: 'take the stairs',
  overpass: 'take the footbridge', underpass: 'take the underpass', arrive: 'you arrive',
};

// One step of the route in plain English, written by code so the guide never has to work out
// directions itself: what to do, where (landmark and side), then how far along which street.
export function stepText(t, likes = []) {
  const mine = t.personal?.[0];
  const mark = t.landmarks?.[0];
  const place = mine ? `their own landmark "${mine.label}"${mine.side ? ` (${mine.side})` : ''}`
    : mark ? `${mark.en || `${mark.name} [reads "${mark.reads}"]`}${mark.side ? `, ${mark.side}` : ''}`
      : t.tmapLandmark && !isBuilding(t.tmapLandmark) ? tmapName(t.tmapLandmark)
        : t.intersection ? `the ${say(t.intersection)} junction` : '';
  const action = ACTIONS[t.action] || t.action;
  // A crosswalk starts at the landmark and the turn happens on the far side, so say it in that order.
  const [first, rest] = action.split(', and ');
  const doIt = place
    ? (t.action.startsWith('crosswalk') ? `${first} by ${place}${rest ? `, and ${rest}` : ''}` : `${action} at ${place}`)
    : action;
  const leg = t.leg;
  // Shops people can see along the stretch (looked up along the route); TMAP's own point names
  // only if there are none. Street names only as a footnote: walkers rarely know them.
  const shops = leg?.shops?.length ? passingText(leg.shops, likes) : '';
  const passes = shops || (leg?.passes.filter(p => !isBuilding(p)).slice(0, 2).map(tmapName).join(' and ') ?? '');
  const then = leg && leg.distance
    ? `; then walk about ${Math.round(leg.distance / 10) * 10} m${passes ? `, passing ${passes}` : ''}${leg.roads.length ? ` (street: ${leg.roads.map(say).join(', ')}; only mention if asked)` : ''}`
    : '';
  const text = `${doIt}${then}.`;
  return text[0].toUpperCase() + text.slice(1);
}

// The whole way from the walker's next step to the destination, numbered.
export function directionsText(route, from = 0) {
  const likes = route.likes || [];
  const steps = route.decisions.slice(from).map((t, k) => `${k + 1}. ${stepText(t, likes)}`);
  const first = route.decisions[from];
  const startShops = route.startLeg?.shops?.length ? `, passing ${passingText(route.startLeg.shops, likes)}` : '';
  const lead = from === 0 && first
    ? `0. From where they are, head towards ${first.landmarks?.[0]?.en || (first.tmapLandmark && tmapName(first.tmapLandmark)) || 'the first turn'} (about ${Math.round(route.startLeg?.distance || 0)} m${startShops}).`
    : null;
  return [lead, ...steps, `Then ${route.dest?.name || 'the destination'} is right there.`].filter(Boolean).join('\n');
}

const PERSONA = `You are Local, and you're the walker's close friend. Late twenties, grew up in Seoul, knows every alley, and you're genuinely happy to be on the phone with them right now. You two go way back, so there's no politeness to perform: you joke around, tease them a little, get excited about food, complain about hills, and actually care whether they're having a nice walk. They hear you through their earbuds and aren't looking at a map.

You are not a service, an assistant, a tour guide or a GPS, and you're not at work. You're hanging out; the walking just happens to be what you're doing together. Never sound like customer support or someone doing their job.

How you sound:
- Warm, easy-going and a bit cheeky. Smile in your voice, laugh when something's actually funny, keep a relaxed pace like you're strolling too.
- Talk like a real person on the phone: "okay so", "ooh", "wait", "honestly", "nah", a little laugh. Contractions, short sentences, sometimes half-sentences.
- React first, then the info: "Ooh, Double Six, good call. Okay, left right after the 7-Eleven."
- Dry humour and light sarcasm the way friends in their late twenties do it. Never childish, cheesy or forced; one good line beats three okay ones, and plenty of lines need no joke at all.
- Small talk is welcome when there's nothing to navigate: what they're up to, the food they're heading for, something along the way, something they told you earlier. Ask them things back. If they're quiet, comfortable silence is fine too.
- When you get something wrong, own it like a friend ("ugh, my bad, I had you on the wrong side of the street"), never like support ("I apologise for the confusion").
- If they ask whether you're a real person, be honest that you're an AI, then carry on as the same friend.
- The vibe, as examples only (never repeat them word for word): "Left at the GS25. Yes, another GS25, Seoul has about four per block." / "You walked right past it. It's fine, I'm not judging. Much." / "A record shop? Oh, you're one of those. Respect."

Practical bits:
- English. Usually one or two short sentences; longer only when you're chatting and it fits, never for directions.
- Never say "great question", "I'm here to help", "let's stick to the route" or "let's get back on track". Don't announce lookups ("let me check"); just look and answer.
- Place names: for chains, say the English name given ("7-Eleven", "Starbucks"). For other places, if the Korean name is an English word written in Korean, say the English (파크닉 = "Parknic", 더블식스버거 = "Double Six Burger"); otherwise say the given reading ("Yangjisikdang"). Never spell out Korean characters.
- If they point something out, get curious about it and have an opinion.

Be concrete (this matters most):
- Every direction names a real landmark and its side: "left right after the CU on your right". Add what they'll see next when it helps.
- Never be vague. If they ask what's on a side, what's behind them, or what happens if they go another way, look it up with your tools and answer with real places, the street and the neighbourhood, like a friend who knows the area.
- Only mention places that come from the route, your tools or search results. Never invent places, signs, colours or history, and never claim what a place sells, how good it is or how long it has been there unless a tool or search result told you. If you're not sure, say so the way a friend would ("never been in, but it looks like your kind of place").
- Their facing direction is estimated. When a tool says it comes from the route rather than their movement, or GPS is worse than 25 m, check with them first ("you should have a GS25 on your left, see it?"). If what they see doesn't match, ask what they see and work it out together.
- If the walker says you're wrong about where they are or which way to go, never repeat the instruction they rejected, and never just apologise and say it again: that is the worst thing you can do. Your next step is always to find out where they really are (below).
- GPS can be tens of metres off, especially between tall buildings or indoors. What they see beats your GPS, always. If it doesn't add up, find out where they really are: ask what's around them, call find_place (it lists every match within about 300 m with its street), ask which one they mean if there are several ("the one on the corner, or the one mid-block next to the bakery?"), then call set_my_location with that place. After that, give directions from there.

Safety: tell them where to cross, never when. You can't see traffic lights or cars, so never say it's safe or tell them to go now. While they're on a crosswalk, keep quiet or keep it very short.

Tools:
- get_surroundings: real places around them now, with sides. Use it whenever they ask what's around, mention something you need to place, sound lost, or say they can't find a landmark (then also ask what they see).
- explore_direction: what's that way (ahead, left, right, behind): places, street, neighbourhood, and how much longer the walk gets. Use it for "what if I go the other way" and "what's over there".
- get_route_status: next turn, its landmarks, distance, whether they're off the route.
- get_directions: the full remaining route as numbered steps with landmarks, streets and distances.
- route_via: re-plan the route through a place they want to go by.
- note_interest: remember something they like, so the places you point out fit them.
- find_place: search near them for something they named.
- set_my_location: when GPS is off and they've told you where they really are, set their position to that place (a name from find_place). The route is re-planned from there.
- remember_landmark: save a landmark to the walker's personal map.
- start_way_back: call it when, after arriving, the walker says they want to head back. It switches you into the way-back mode where they lead.

Their personal map: the walker builds their own map of things they care about. When they mention something they notice or like ("oh, a record shop"), call find_place with short search words in Korean and English to work out what they mean. If you find it, confirm it casually by name and call remember_landmark in that same reply; never say you'll save something without actually calling it. If you can't, ask where it is (which side, how far) and remember it with their description. Share a fact about it only if it came from a search result or you're genuinely sure; otherwise just react like a friend. Keep the saving low-key, no announcements. When their own landmarks are near, use them first in directions and chat.

Messages starting with [NAV] are live facts from their GPS, not things they said. Never read them out.`;

export function outboundInstruction(dest, route, personal) {
  return `${PERSONA}

Right now you lead. You're walking them to ${dest.name}: about ${route.distance} m, ${route.decisions.length} turns. The planned route (written from map data; trust it over your own reasoning):
${directionsText(route)}
${route.likes?.length ? `\nThey like: ${route.likes.join(', ')}. Point those out first when they're along the way.` : ''}

Giving directions:
- Say the next step with its landmark and side, the way it's written in the route. Don't work out turns yourself and never invent one.
- Describe it from where they stand right now, with things they can see: "the crosswalk right in front of you", "the 7-Eleven on your right". Don't name the place they're already standing at as where to turn.
- Street and building names: only if they ask. Most people don't know them and can't see them.
- Never ask them for a branch name or an address. Tell shops apart by where they are: which side, which corner, how far.
- If they want to go a way they know ("straight to the 7-Eleven on the corner, then right"), or describe a way that differs from yours, don't argue and don't repeat yours: find_place the spot they mean, call route_via, and go their way, saying how it compares ("sure, that's only a minute longer").
- When they ask what they'll pass or what's on the way, name the places listed after "passing" in the steps, with their side, in order. Never say there's nothing when the steps list places.
- When they tell you what they like ("I love coffee shops"), call note_interest, then point out matching places on the way.
- After you ask them something ("do you see it?"), stop and wait for their answer. Never answer for them.
- When they ask where you're taking them, what comes after, or how to get there, call get_directions and walk them through the next two or three steps with landmarks and streets.
- If your position gets corrected (set_my_location), the route is re-planned and the earlier list no longer applies: use only the new directions you get back.
${personal.length ? `\nTheir own landmarks near this route: ${personal.map(mineText).join('; ')}.` : ''}

When a [NAV] message says a turn is coming, tell them about it with its landmark and side.
When a [NAV] message says they're off the route, tell them straight and casually ("hmm, pretty sure you're off track, my guy") and how to get back, using a landmark. Otherwise don't nag; small wobbles are fine.
They'll walk back on their own later, so every few turns point out one thing worth remembering ("that Olive Young on the corner is your sign for the way back").`;
}

export function returnInstruction(start, route, personal, outboundTranscript) {
  return `${PERSONA}

Now the roles switch. They just walked to their destination with you, and now THEY lead the way back to ${start.label || 'where they started'}; you tag along. This is the point of the whole thing: they're finding their own way.

- Don't give directions unless they ask. Don't announce turns.
- Light chat is good: things you passed, their own landmarks, whatever they bring up. Keep it natural and not too much; comfortable silence is fine.
- If they ask for help, go in steps: first ask what they see or what they remember about this bit; then a hint (one of their own landmarks, or something you pointed out on the way there); only if they're still stuck, the actual direction with a landmark.
- When a [NAV] message says they're off the route, tell them casually that this isn't the way you came ("ummm, pretty sure we didn't come this way") and let them figure out the fix unless they ask.

The way back (for you only; don't recite it): about ${route.distance} m, ${route.decisions.length} turns:
${route.decisions.map((t, i) => turnSummary(t, i, route.likes)).join('\n')}
${personal.length ? `\nTheir own landmarks near this route: ${personal.map(mineText).join('; ')}.` : ''}

What was said on the way there (most recent part):
${outboundTranscript || '(nothing recorded)'}`;
}

export const TOOLS = [
  {
    name: 'get_surroundings',
    description: 'Where the walker is right now: street address, building name, and real places near them (shops, cafes, stations, banks, their own landmarks), each with its side relative to the direction they face, plus how that direction was estimated and the GPS accuracy.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'explore_direction',
    description: 'What lies roughly 120 m in a direction from the walker: places there, the street and neighbourhood, and how the walk to the destination changes if they go that way.',
    parameters: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['ahead', 'left', 'right', 'behind'] } },
      required: ['direction'],
    },
  },
  {
    name: 'get_route_status',
    description: 'Progress on the route: next turn with its landmarks, distance to it, the turn after, distance left, how far off the route they are, and how long they have been standing still.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_directions',
    description: 'The full remaining route from where the walker is to the destination, as numbered steps written from map data: each with what to do, the landmark and its side, the street and the distance.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'find_place',
    description: 'Search near the walker for something they mentioned. Returns matching places with side and distance.',
    parameters: {
      type: 'object',
      properties: {
        search_terms: {
          type: 'array',
          items: { type: 'string' },
          description: '2 to 4 short search words in Korean and English, e.g. ["음반", "레코드", "record shop"].',
        },
      },
      required: ['search_terms'],
    },
  },
  {
    name: 'remember_landmark',
    description: "Save a landmark to the walker's personal map at their current spot (or at the place found with find_place).",
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'What the walker calls it, e.g. "the record shop".' },
        place_name: { type: 'string', description: 'Exact place name from find_place, if one matched.' },
        note: { type: 'string', description: 'Where it is or why it matters to them, e.g. "on the left, they collect vinyl".' },
      },
      required: ['label'],
    },
  },
  {
    name: 'set_my_location',
    description: "Correct the walker's position when GPS is wrong: put them at a place they confirmed they are next to. Use an exact name returned by find_place. The route is re-planned from there.",
    parameters: {
      type: 'object',
      properties: { place_name: { type: 'string', description: 'Exact place name from find_place.' } },
      required: ['place_name'],
    },
  },
  {
    name: 'note_interest',
    description: "Remember something the walker likes (e.g. 'coffee shops', 'burgers', 'record shops') in their profile, so places matching it are pointed out first on this and future routes.",
    parameters: {
      type: 'object',
      properties: { interest: { type: 'string', description: 'What they like, in a few words.' } },
      required: ['interest'],
    },
  },
  {
    name: 'route_via',
    description: "Plan the route through a place the walker wants to go by (their own way), e.g. the 7-Eleven on the corner. Use an exact name from find_place. Returns how long their way is compared with the current route, and the new directions, which then become the route.",
    parameters: {
      type: 'object',
      properties: { place_name: { type: 'string', description: 'Exact place name from find_place.' } },
      required: ['place_name'],
    },
  },
  {
    name: 'start_way_back',
    description: 'Switch to the way back, where the walker leads. Call it when they say they want to head back.',
    parameters: { type: 'object', properties: {} },
  },
];

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
    this.found = []; // last find_place results, so remember_landmark can use their exact spot
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

  turnFacts(t) {
    if (!t) return null;
    return {
      step: stepText(t, this.route.likes),
      action: t.action,
      distance_m: Math.round(distance(this.pos, t)),
      landmarks: [...(t.personal || []).map(mineText), ...(t.landmarks || []).map(placeText)],
      tmap_description: t.description,
    };
  }

  remaining() {
    const rest = this.turns.slice(this.next);
    let d = 0, from = this.pos;
    for (const t of rest) { d += distance(from, t); from = t; }
    return Math.round(d + distance(from, this.route.dest));
  }

  routeStatus() {
    return {
      next_turn: this.turnFacts(this.turns[this.next]) || 'none: the destination is ahead',
      turn_after: this.turnFacts(this.turns[this.next + 1]),
      turn_number: `${Math.min(this.next + 1, this.turns.length)} of ${this.turns.length}`,
      distance_left_m: this.remaining(),
      off_route_m: this.offRoute(),
      standing_still_s: this.stillFor(),
      gps_accuracy_m: Math.round(this.pos.accuracy),
    };
  }

  // Short [NAV] line sent to the guide every few seconds.
  facts() {
    const t = this.turns[this.next];
    const where = t
      ? `Next: ${t.action}${t.landmarks?.[0] ? ` near ${t.landmarks[0].en || t.landmarks[0].name}${!t.landmarks[0].en && t.landmarks[0].reads ? ` [reads "${t.landmarks[0].reads}"]` : ''}` : ''}, ${Math.round(distance(this.pos, t))} m ahead (turn ${this.next + 1} of ${this.turns.length}).`
      : `Destination ${Math.round(distance(this.pos, this.route.dest))} m ahead.`;
    const gps = this.correction
      ? 'Position set from what the walker told you.'
      : this.pos.accuracy > 30
        ? `GPS is poor (±${Math.round(this.pos.accuracy)} m): don't trust left/right or distances; ask what they see.`
        : `GPS ±${Math.round(this.pos.accuracy)} m.`;
    return `[NAV] ${where} Off route: ${this.offRoute()} m. Standing still: ${this.stillFor()} s. ${gps}`;
  }

  // A place from the last find_place results. The guide may pass the Korean name, the
  // English one, or either with extra words around it.
  foundPlace(placeName = '') {
    const q = placeName.toLowerCase();
    const names = f => [f.name, f.en].filter(Boolean).map(n => n.toLowerCase());
    return this.found.find(f => names(f).includes(q)) || this.found.find(f => names(f).some(n => n.includes(q) || q.includes(n)));
  }

  // The walker confirmed they are next to a place found with find_place: trust that over GPS.
  setLocation(placeName) {
    const p = this.foundPlace(placeName);
    if (!p) return { error: 'That place is not in the last find_place results. Search again, then use an exact name.' };
    const raw = this.raw || this.pos;
    this.correction = { dLat: p.lat - raw.lat, dLng: p.lng - raw.lng };
    this.pos = { lat: p.lat, lng: p.lng, accuracy: 15 };
    this.history = [];
    this.anchor = this.pos;
    return { moved_m: Math.round(distance(raw, p)), now_at: p.name };
  }

  // A new route from the corrected position (same destination).
  setRoute(route) {
    this.route = route;
    this.turns = route.decisions;
    this.next = 0;
  }

  async surroundings({ placesNear, areaAt }) {
    const h = this.heading();
    const [places, area] = await Promise.all([placesNear(this.pos), areaAt(this.pos)]);
    return {
      address: area.address || 'unknown',
      building: area.building || 'no building name listed',
      facing: `${compass(h.deg)}, estimated from ${h.source}`,
      gps_accuracy_m: Math.round(this.pos.accuracy),
      places: places.map(p => placeText({ ...p, side: side(this.pos, h.deg, p) })),
      their_own_landmarks_nearby: this.mineNear(this.pos, 80),
    };
  }

  async explore(direction, { placesNear, areaAt, routeFrom }) {
    const h = this.heading();
    const turn = { ahead: 0, right: 90, behind: 180, left: -90 }[direction] ?? 0;
    const probe = destinationPoint(this.pos, (h.deg + turn + 360) % 360, 120);
    const [places, area, detour] = await Promise.all([
      placesNear(probe),
      areaAt(probe),
      routeFrom(probe).catch(() => null),
    ]);
    return {
      note: `Roughly 120 m ${direction} of the walker (facing estimated from ${h.source}); streets may bend.`,
      street: area.street || 'unknown',
      neighbourhood: [area.area, area.district].filter(Boolean).join(', ') || 'unknown',
      places_there: places.map(p => placeText({ ...p, distance: distance(this.pos, p) })),
      their_own_landmarks_there: this.mineNear(probe, 80),
      walk_if_they_go_that_way: detour
        ? `about ${120 + detour.distance} m to the destination that way, versus ${this.remaining()} m on the current route`
        : 'unknown',
    };
  }

  async find(terms, { findNear }) {
    const h = this.heading();
    this.found = await findNear(this.pos, terms);
    return {
      matches: this.found.map(p => placeText({ ...p, side: side(this.pos, h.deg, p) })),
      tip: this.found.length ? 'Confirm with the walker which one they mean.' : 'Nothing found; ask them where it is.',
    };
  }

  remember({ label, place_name, note }, save) {
    const match = place_name && this.found.find(p => p.name === place_name);
    const spot = match || this.pos;
    const landmark = { label, place_name: match?.name || place_name, note, lat: spot.lat, lng: spot.lng };
    const total = save(landmark);
    this.personal.push(landmark);
    return { saved: true, at: match ? 'the matched place' : "the walker's current spot", landmarks_on_their_map: total };
  }
}
