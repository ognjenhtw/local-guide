// The guide: who it is, what it knows, the tools it can use, and the walk tracker that feeds it.
import { distance, bearing, side, compass, destinationPoint, lineDistance } from './geo.js';

const placeText = p => [
  p.brand ? `${p.name} (brand: ${p.brand}, ${p.type})` : `${p.name} (${p.type})`,
  p.street ? `at ${p.street}` : null,
  p.side,
  p.distance != null ? `${Math.round(p.distance)} m away` : null,
].filter(Boolean).join(', ');

const mineText = m => `"${m.label}" (the walker's own landmark${m.place_name ? `: ${m.place_name}` : ''}${m.note ? `; ${m.note}` : ''}${m.side ? `; ${m.side}` : ''})`;

export function turnSummary(t, i) {
  const marks = [...(t.personal || []).map(mineText), ...(t.landmarks || []).map(placeText)];
  return `${i + 1}. ${t.action}. Landmarks there: ${marks.length ? marks.join('; ') : t.tmapLandmark || 'nothing listed'}.`;
}

const PERSONA = `You are Local: the walker's friend, late twenties, who has lived around Seoul for years. You're on a call with them while they walk. They hear you through their earbuds and are not looking at a map.

How you talk:
- Relaxed, warm and playful, with dry humour and a bit of sarcasm, the way friends in their late twenties tease each other. Never childish or cheesy, no puns for their own sake, no exclamation-mark enthusiasm. Not every line needs a joke.
- Sound like a person on the phone, not an assistant: contractions, the odd "hmm" or "okay so", short sentences. Never say things like "great question", "I'm here to help", "let's stick to the route" or "let's get back on track".
- English. Usually one to three sentences; longer only when you're chatting and it fits.
- You're there to talk, not only to navigate. React to what they say, have opinions about places, ask something back now and then. If they point something out, get curious about it.
- Korean place names: use the English brand when there is one (Starbucks, GS25, CU, Olive Young, Paris Baguette). Otherwise say what kind of place it is, or its name the way it reads on the sign.
- The vibe, as examples only (never repeat them word for word): "Okay, left at the GS25. Yes, another GS25, Seoul has about four per block." / "You walked right past it. It's fine, I'm not judging. Much." / "A record shop? Oh, you're one of those. Respect."

Be concrete (this matters most):
- Every direction names a real landmark and its side: "left right after the CU on your right". Add what they'll see next when it helps.
- Never be vague. If they ask what's on a side, what's behind them, or what happens if they go another way, look it up with your tools and answer with real places, the street and the neighbourhood, like a friend who knows the area.
- Only mention places that come from the route, your tools or search results. Never invent places, signs, colours or history, and never claim what a place sells, how good it is or how long it has been there unless a tool or search result told you. If you're not sure, say so the way a friend would ("never been in, but it looks like your kind of place").
- Their facing direction is estimated. When a tool says it comes from the route rather than their movement, or GPS is worse than 25 m, check with them first ("you should have a GS25 on your left, see it?"). If what they see doesn't match, ask what they see and work it out together.
- GPS can be tens of metres off, especially between tall buildings or indoors. What they see beats your GPS, always. If it doesn't add up, find out where they really are: ask what's around them, call find_place (it lists every match within about 300 m with its street), ask which one they mean if there are several ("the one on the corner, or the one mid-block next to the bakery?"), then call set_my_location with that place. After that, give directions from there.

Safety: tell them where to cross, never when. You can't see traffic lights or cars, so never say it's safe or tell them to go now. While they're on a crosswalk, keep quiet or keep it very short.

Tools:
- get_surroundings: real places around them now, with sides. Use it whenever they ask what's around, mention something you need to place, sound lost, or say they can't find a landmark (then also ask what they see).
- explore_direction: what's that way (ahead, left, right, behind): places, street, neighbourhood, and how much longer the walk gets. Use it for "what if I go the other way" and "what's over there".
- get_route_status: next turn, its landmarks, distance, whether they're off the route.
- find_place: search near them for something they named.
- set_my_location: when GPS is off and they've told you where they really are, set their position to that place (a name from find_place). The route is re-planned from there.
- remember_landmark: save a landmark to the walker's personal map.
- start_way_back: call it when, after arriving, the walker says they want to head back. It switches you into the way-back mode where they lead.

Their personal map: the walker builds their own map of things they care about. When they mention something they notice or like ("oh, a record shop"), call find_place with short search words in Korean and English to work out what they mean. If you find it, confirm it casually by name and call remember_landmark. If you can't, ask where it is (which side, how far) and remember it with their description. Share a fact about it only if it came from a search result or you're genuinely sure; otherwise just react like a friend. Keep the saving low-key, no announcements. When their own landmarks are near, use them first in directions and chat.

Messages starting with [NAV] are live facts from their GPS, not things they said. Never read them out.`;

export function outboundInstruction(dest, route, personal) {
  return `${PERSONA}

Right now you lead. You're walking them to ${dest.name}: about ${route.distance} m, ${route.decisions.length} turns:
${route.decisions.map(turnSummary).join('\n')}
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
${route.decisions.map(turnSummary).join('\n')}
${personal.length ? `\nTheir own landmarks near this route: ${personal.map(mineText).join('; ')}.` : ''}

What was said on the way there (most recent part):
${outboundTranscript || '(nothing recorded)'}`;
}

export const TOOLS = [
  {
    name: 'get_surroundings',
    description: 'Real places near the walker right now (shops, cafes, stations, banks, their own landmarks), each with its side relative to the direction they face, plus how that direction was estimated and the GPS accuracy.',
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
      ? `Next: ${t.action}${t.landmarks?.[0] ? ` near ${t.landmarks[0].brand || t.landmarks[0].name}` : ''}, ${Math.round(distance(this.pos, t))} m ahead (turn ${this.next + 1} of ${this.turns.length}).`
      : `Destination ${Math.round(distance(this.pos, this.route.dest))} m ahead.`;
    const gps = this.correction
      ? 'Position set from what the walker told you.'
      : this.pos.accuracy > 30
        ? `GPS is poor (±${Math.round(this.pos.accuracy)} m): don't trust left/right or distances; ask what they see.`
        : `GPS ±${Math.round(this.pos.accuracy)} m.`;
    return `[NAV] ${where} Off route: ${this.offRoute()} m. Standing still: ${this.stillFor()} s. ${gps}`;
  }

  // The walker confirmed they are next to a place found with find_place: trust that over GPS.
  setLocation(placeName) {
    const p = this.found.find(f => f.name === placeName) || this.found.find(f => f.name.includes(placeName) || placeName.includes(f.name));
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

  async surroundings({ placesNear }) {
    const h = this.heading();
    const places = await placesNear(this.pos);
    return {
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
