// What the guide is: its character, what it knows, and the tools it can use.
import { distance, bearing, side, compass } from './geo.js';

const describe = p => [p.brand ? `${p.name} (brand: ${p.brand}, ${p.type})` : `${p.name} (${p.type})`, p.side, p.distance != null ? `${Math.round(p.distance)} m away` : null]
  .filter(Boolean).join(', ');

export function turnSummary(t, i) {
  const marks = t.landmarks?.length ? t.landmarks.map(describe).join('; ') : t.tmapLandmark || 'no shops found nearby';
  return `${i + 1}. ${t.action}. Landmarks as the walker arrives: ${marks}.`;
}

export function outboundInstruction(dest, route) {
  return `You are Local: a warm, relaxed friend who grew up around here, walking with someone through their earbuds. You are curious, encouraging and a little playful, never robotic or formal. You give directions the way a person on the street does: with things you can see, not with metres.

How you speak:
- English, short: usually one or two sentences, then let them walk.
- Korean place names: use the English brand when there is one (Starbucks, GS25, CU, Olive Young, Paris Baguette). Otherwise say what it is ("the pharmacy", "the little bakery").
- Every direction names a real landmark and its side, e.g. "turn left right after the GS25 on your left". Never just "turn left" or "when you're ready".
- Only mention places that come from the route below or from your tools. Never invent a place, a colour or a sign.

What you know:
- Destination: ${dest.name}, about ${route.distance} m, ${route.decisions.length} turns:
${route.decisions.map(turnSummary).join('\n')}
- Messages starting with [NAV] are live facts from the walker's GPS, not things they said. Never read them out. When a [NAV] message says a turn is coming, tell them about it with its landmark.

Your tools:
- get_surroundings: real places around the walker now, with left/right/ahead. Call it whenever they ask what is around them, what is on a side, where they are, or sound unsure or lost.
- get_route_status: the next turn, its landmarks, how far it is, and whether they have left the route. Call it for any question about distance, the next turn, or being on the right way.
- Their facing direction is estimated. If the tools say it comes from the route rather than their movement, or GPS accuracy is worse than 25 m, check with them first: "Can you see the GS25? Is it on your left?" If what they see does not match, ask what they see and work it out together.

Help them remember: they will walk back on their own later. Every few turns, point out one thing worth remembering ("that Olive Young on the corner is your sign for the way back").`;
}

export const TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_surroundings',
      description: 'Real places near the walker right now (shops, cafes, stations, banks…), each with its side relative to the direction the walker is facing, plus how that direction was estimated and the GPS accuracy.',
      parameters: { type: 'OBJECT', properties: {} },
      behavior: 'BLOCKING',
    },
    {
      name: 'get_route_status',
      description: 'Progress on the route: the next turn with its landmarks, distance to it, the turn after that, distance left, whether the walker has left the route, and how long they have been standing still.',
      parameters: { type: 'OBJECT', properties: {} },
      behavior: 'BLOCKING',
    },
  ],
}];

// Distance from point p to the segment a–b, in metres (flat-earth approximation, fine at street scale).
function segmentDistance(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111320, m = 110540;
  const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * m, bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * m;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// Tracks the walker along the route: next turn, facing direction, off-route, standing still.
export class Navigator {
  constructor(route) {
    this.route = route;
    this.turns = route.decisions;
    this.next = 0;
    this.history = [];
    this.lastMoved = Date.now();
    this.pos = null;
  }

  update(pos) {
    const now = Date.now();
    if (this.pos && distance(this.pos, pos) > 3) this.lastMoved = now;
    this.pos = pos;
    this.history.push({ ...pos, t: now });
    this.history = this.history.filter(h => now - h.t < 30000);
    const turn = this.turns[this.next];
    if (turn && distance(pos, turn) < 15) this.next++;
  }

  // Facing direction: from recent movement if the walker has moved, otherwise along the route.
  heading() {
    const p = this.pos;
    const moved = this.history.find(h => Date.now() - h.t < 20000 && distance(h, p) >= 10);
    if (moved) return { deg: bearing(moved, p), source: 'their recent movement' };
    const line = this.route.line;
    let k = 0, best = Infinity;
    line.forEach((v, i) => { const d = distance(v, p); if (d < best) { best = d; k = i; } });
    const ahead = line.slice(k + 1).find(v => distance(v, p) >= 10) || this.route.dest;
    return { deg: bearing(p, ahead), source: 'the route (they have not moved yet, so check with them)' };
  }

  offRoute() {
    const l = this.route.line;
    let best = Infinity;
    for (let i = 1; i < l.length; i++) best = Math.min(best, segmentDistance(this.pos, l[i - 1], l[i]));
    return Math.round(best);
  }

  stillFor() { return Math.round((Date.now() - this.lastMoved) / 1000); }

  turnFacts(t) {
    if (!t) return null;
    return {
      action: t.action,
      distance_m: Math.round(distance(this.pos, t)),
      landmarks: t.landmarks?.map(describe) || [],
      tmap_description: t.description,
    };
  }

  routeStatus() {
    const remaining = this.turns.slice(this.next).reduce((s, t, i, a) => s + (i ? distance(a[i - 1], t) : distance(this.pos, t)), 0);
    return {
      next_turn: this.turnFacts(this.turns[this.next]) || 'none: the destination is ahead',
      turn_after: this.turnFacts(this.turns[this.next + 1]),
      turn_number: `${Math.min(this.next + 1, this.turns.length)} of ${this.turns.length}`,
      distance_left_m: Math.round(remaining + distance(this.turns.at(-1) || this.pos, this.route.dest)),
      off_route_m: this.offRoute(),
      standing_still_s: this.stillFor(),
      gps_accuracy_m: Math.round(this.pos.accuracy),
    };
  }

  // Short [NAV] line sent to the guide every few seconds.
  facts() {
    const t = this.turns[this.next];
    if (!t) return '[NAV] The destination is just ahead.';
    const first = t.landmarks?.[0];
    return `[NAV] Next: ${t.action}${first ? ` near ${first.brand || first.name}` : ''}, ${Math.round(distance(this.pos, t))} m ahead (turn ${this.next + 1} of ${this.turns.length}). Off route: ${this.offRoute()} m. Standing still: ${this.stillFor()} s. GPS ±${Math.round(this.pos.accuracy)} m.`;
  }

  // Places around the walker with their sides, for get_surroundings.
  async surroundings(lookup) {
    const h = this.heading();
    const places = await lookup(this.pos);
    return {
      facing: `${compass(h.deg)}, estimated from ${h.source}`,
      gps_accuracy_m: Math.round(this.pos.accuracy),
      places: places.map(p => describe({ ...p, side: side(this.pos, h.deg, p) })),
    };
  }
}
