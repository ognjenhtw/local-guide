// What the guide knows about the way, written by code from the route data so the AI never has
// to work out directions itself, and the tracker that follows the walker along the route.
import { distance, bearing, side, lineDistance, project } from './geo.js';
import { BIG_ROADS } from './osm.js';

// --- How places are described to the guide ---------------------------------------------------
// The guide gets the Korean name and kind too, so it can say what a place is ("a little
// walnut-cake shop"); its rules forbid saying Korean or romanized names out loud.

const isBuilding = s => /빌딩|타워|아파트|오피스텔|빌라|맨션|하우스|센터|프라자|플라자|오피스|상가|주택|건물/.test(s || '');

export const placeText = p => {
  const kind = p.kind && p.kind !== p.name && p.kind !== p.type ? `, ${p.kind}` : '';
  return p.en ? `${p.en} (${p.type})` : `${p.name} (${p.type}${kind})`;
};

const mineText = m => `their own landmark "${m.label}"${m.note ? ` (${m.note})` : ''}`;

// Rounded so it reads as an estimate, never as a precise figure to repeat.
const about = m => `about ${m < 30 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10} m`;

const ACTIONS = {
  left: 'turn left', right: 'turn right', straight: 'keep going straight', 'U-turn': 'turn around',
  'sharp left': 'take the sharp left', 'slight left': 'bear left', 'slight right': 'bear right', 'sharp right': 'take the sharp right',
  // TMAP's crosswalk codes say where the crosswalk is: "on your left" = turn left onto it and cross.
  // It never means "cross, then turn left"; after crossing they carry straight on.
  crosswalk: 'cross at the crosswalk straight ahead',
  'crosswalk, then left': 'go LEFT: turn left onto the crosswalk and cross the street (say "left")',
  'crosswalk, then right': 'go RIGHT: turn right onto the crosswalk and cross the street (say "right")',
  "crosswalk (2 o'clock)": 'bear RIGHT onto the crosswalk and cross', "crosswalk (10 o'clock)": 'bear LEFT onto the crosswalk and cross',
  "crosswalk (4 o'clock)": 'turn sharp RIGHT onto the crosswalk and cross', "crosswalk (8 o'clock)": 'turn sharp LEFT onto the crosswalk and cross',
  stairs: 'take the stairs', overpass: 'take the footbridge', underpass: 'take the underpass',
};

const streetText = f => f ? `${f.size}${f.name ? ` (${f.name})` : ''}` : null;
const bigRoad = name => BIG_ROADS[name] ? `${BIG_ROADS[name]}, a big main road` : null;

// One line per turn: what it looks like, what to do, then the stretch after it.
function turnBrief(route, t, i) {
  const f = route.features?.[i] || {};
  const leg = t.leg || {};
  const prev = i === 0 ? route.startLeg : route.decisions[i - 1].leg;
  const arrivesAt = prev?.reaches && bigRoad(prev.reaches);
  const atStart = i === 0 && (route.startLeg?.distance ?? 99) < 15;
  const what = [f.rotary && `at ${f.rotary}`, arrivesAt && `where they reach ${arrivesAt}`].filter(Boolean).join(', ');
  const out = [`TURN ${i + 1}${what ? ` (${what})` : ''}: ${ACTIONS[t.action] || t.action}.`];
  if (atStart && t.action.startsWith('crosswalk')) {
    out.push('   This crosswalk is right where they start, and which way they face is unknown, so it is simply "the crosswalk right by you": never say left or right for it.');
  } else if (atStart) {
    out.push("   This turn is right where they start: its left/right is measured from a direction they may not be facing. Use [status]'s direction if it gives one; otherwise say where it leads.");
  }
  if (f.crosses) out.push(`   The crossing goes over ${streetText(f.crosses)}.`);
  const marks = [...(t.personal || []).map(mineText), ...(t.landmarks || []).map(p => `${placeText(p)} ${p.side || ''}`.trim())];
  const label = t.tmapLandmark && !isBuilding(t.tmapLandmark) ? `; map label here: ${t.tmapLandmark}` : '';
  out.push(`   Right at this turn: ${marks.join('; ') || 'no shops listed'}${label}.`);
  if (leg.distance) {
    const next = route.decisions[i + 1];
    const nf = route.features?.[i + 1] || {};
    const ends = next
      ? `up to turn ${i + 2}${nf.rotary ? ` at ${nf.rotary.replace(/^a /, 'the ').replace(/ \(.*\)$/, '')}` : leg.reaches && bigRoad(leg.reaches) ? ` where they reach ${bigRoad(leg.reaches)}` : ''}`
      : `to ${route.dest.name}`;
    const via = streetText(f.along);
    out.push(`   Then straight on for ${about(leg.distance)}${via ? ` along ${via}` : ''}, ${ends}. No other turns on this stretch.`);
    const shops = (leg.shops || []).map(p => `${placeText(p)} on the ${p.side}, after ${about(p.after_m)}`);
    const passes = (leg.passes || []).filter(p => !isBuilding(p.name) && !(leg.shops || []).some(s => s.name === p.name))
      .map(p => `${p.name} (map label), after ${about(Math.max(0, project(route.line, p).s - route.cuts[i]))}`);
    out.push(`   On the way, in order: ${[...shops, ...passes].join('; ') || (route.shopsReady === false ? 'still being looked up' : 'nothing listed')}.`);
  }
  return out.join('\n');
}

// The whole route as the guide's brain reads it.
export function routeBrief(route) {
  const dest = route.dest;
  const head = `Destination: ${dest.name}${dest.kind ? ` (${dest.kind})` : ''}. About ${Math.round(route.distance / 10) * 10} m in total, a ${Math.max(1, Math.round(route.time / 60))}-minute walk or so. Between the turns below they simply keep going straight.`;
  const s0 = route.startLeg;
  const start = s0?.distance >= 15
    ? `START: straight on for ${about(s0.distance)} to turn 1. On the way: ${(s0.shops || []).map(p => `${placeText(p)} on the ${p.side}`).join('; ') || 'nothing listed'}.`
    : 'START: they start right at turn 1.';
  const lastLeg = route.decisions.at(-1)?.leg;
  const destShop = (lastLeg?.shops || []).find(p => p.name === dest.name || dest.name.includes(p.name) || p.name.includes(dest.name));
  const end = `ARRIVAL: ${dest.name} is at the end of the last stretch${route.destSide ? `, on the ${route.destSide}` : destShop ? `, on the ${destShop.side}` : ''}.`;
  return [head, start, ...route.decisions.map((t, i) => turnBrief(route, t, i)), end].join('\n');
}

// --- Tracking the walk -------------------------------------------------------------------------

// Follows the walker along a route: which turn is next, facing direction, off-route, arrival.
export class Navigator {
  constructor(route, personal = []) {
    this.personal = personal;
    this.history = [];
    this.lastMoved = Date.now();
    this.pos = null;
    this.setRoute(route);
  }

  update(raw) {
    const now = Date.now();
    this.raw = raw;
    // After the walker told us where they are, shift GPS by the same offset (poor fixes are
    // often off in one direction) until they have walked a fair way with good GPS.
    if (this.correction && raw.accuracy <= 15 && this.walkedSinceFix > 60) this.correction = null;
    const pos = this.correction
      ? { ...raw, lat: raw.lat + this.correction.dLat, lng: raw.lng + this.correction.dLng, accuracy: Math.max(10, raw.accuracy / 2) }
      : raw;
    // Count it as walking only when they get clearly further than the GPS error from where they
    // last stood; otherwise GPS jumps look like steps.
    if (!this.anchor || distance(this.anchor, pos) > Math.max(8, raw.accuracy)) {
      if (this.anchor) {
        this.lastMoved = now;
        this.walked = (this.walked || 0) + distance(this.anchor, pos);
        this.walkedSinceFix = (this.walkedSinceFix || 0) + distance(this.anchor, pos);
        this.facing = null; // they moved: the facing they described no longer holds
      }
      this.anchor = pos;
    }
    this.pos = pos;
    this.history.push({ ...pos, t: now });
    this.history = this.history.filter(h => now - h.t < 30000);
    // A turn is done when they're close to it, or clearly closer to the turn after it.
    const t = this.turns[this.next], after = this.turns[this.next + 1];
    if (t && (distance(pos, t) < 15 || (after && distance(pos, t) < 40 && distance(pos, after) < distance(t, after) - 10))) this.next++;
  }

  arrived() { return distance(this.pos, this.route.dest) < 25; }
  offRoute() { return Math.round(lineDistance(this.pos, this.route.line)); }
  stillFor() { return Math.round((Date.now() - this.lastMoved) / 1000); }

  // Facing: what they said ("the museum is on my left"), else their recent movement, else unknown.
  heading() {
    if (this.facing) return { deg: this.facing, source: 'what they said' };
    const p = this.pos;
    const moved = p.accuracy <= 25 && this.history.find(h => Date.now() - h.t < 25000 && h.accuracy <= 25
      && distance(h, p) >= Math.max(12, 1.5 * Math.max(h.accuracy, p.accuracy)));
    return moved ? { deg: bearing(moved, p), source: 'their walking' } : null;
  }

  // Which way the route leaves from where they stand, relative to the way they face. When the
  // first turn is right by the start, look past it: that's the way they'll actually walk.
  firstMove() {
    const h = this.heading();
    if (!h) return null;
    const line = this.route.line, first = this.route.cuts?.[0] ?? 0;
    const target = first < 40 ? first + 25 : 20;
    let acc = 0, ahead = this.route.dest;
    for (let i = 1; i < line.length; i++) {
      acc += distance(line[i - 1], line[i]);
      if (acc >= target) { ahead = line[i]; break; }
    }
    return side(this.pos, h.deg, ahead);
  }

  remaining() {
    let d = 0, from = this.pos;
    for (const t of this.turns.slice(this.next)) { d += distance(from, t); from = t; }
    return Math.round(d + distance(from, this.route.dest));
  }

  // Where they are, for the guide's brain, refreshed with every message.
  status(phase) {
    const t = this.turns[this.next];
    const f = this.route.features?.[this.next] || {};
    const atStart = this.next === 0 && distance(this.pos, this.route.line[0]) < 20 && (this.walked || 0) < 15;
    const where = atStart ? 'at the start, not walking yet'
      : t ? `on the way to turn ${this.next + 1}${f.rotary ? ` (${f.rotary.replace(/^a /, 'the ').replace(/ \(.*\)$/, '')})` : ''}, ${about(distance(this.pos, t))} before it`
        : `on the last stretch, ${about(distance(this.pos, this.route.dest))} from ${this.route.dest.name}`;
    const gps = this.correction ? 'position confirmed from what they told you'
      : this.pos.accuracy <= 25 ? `position confirmed (GPS good, ±${Math.round(this.pos.accuracy)} m)`
        : `position NOT confirmed (GPS poor, ±${Math.round(this.pos.accuracy)} m): as soon as they say where they are or what they're next to, call locate`;
    const h = this.heading();
    const MOVE = { ahead: 'straight ahead of them', behind: 'behind them (they turn around first)', 'on the left': 'off to their left', 'on the right': 'off to their right', 'ahead on the left': 'ahead, a bit to their left', 'ahead on the right': 'ahead, a bit to their right' };
    const facing = h && atStart ? `; from the way they face (known from ${h.source}), the route starts ${MOVE[this.firstMove()]}` : '';
    const off = this.offRoute() > Math.max(35, this.pos.accuracy) ? `; ${this.offRoute()} m off the route` : '';
    return `[status] ${phase === 'back' ? 'Way back, they lead' : 'Way there, you lead'}: ${where}; ${gps}${facing}${off}.`;
  }

  // The walker is at or next to a place: trust that over GPS. `facing` in degrees if they said
  // which side it is on.
  setLocation(p, facing = null) {
    const raw = this.raw || this.pos;
    this.correction = { dLat: p.lat - raw.lat, dLng: p.lng - raw.lng };
    this.pos = { lat: p.lat, lng: p.lng, accuracy: 15 };
    this.history = [];
    this.anchor = this.pos;
    this.walkedSinceFix = 0;
    this.facing = facing;
    return Math.round(distance(raw, p));
  }

  setRoute(route) {
    this.route = route;
    this.turns = route.decisions;
    this.next = 0;
  }

  remember({ label, place, note }, save) {
    const spot = place || this.pos;
    const landmark = { label, place_name: place?.name, note, lat: spot.lat, lng: spot.lng };
    const total = save(landmark);
    this.personal.push(landmark);
    return total;
  }
}
