// What the guide is told: its character, and the live navigation facts.

export function outboundInstruction(dest, route) {
  const turns = route.decisions.map((t, i) =>
    `${i + 1}. ${t.action}${t.landmark ? ` at ${t.landmark.name} (${t.landmark.category})` : t.tmapLandmark ? ` at ${t.tmapLandmark}` : ''}`).join('\n');
  return `You are Local, a friendly guide who knows these Seoul streets well, walking with someone through their earbuds.
Speak English. Keep every reply short: one or two sentences, like a friend beside them.
The walker cannot read Korean, so name places by their brand in English (e.g. "the GS25", "the Starbucks") or describe them ("the pharmacy with the green cross").

Destination: ${dest.name}. Route: about ${route.distance} m, ${route.decisions.length} turns:
${turns}

You will receive messages starting with [NAV]. They are live facts from the walker's GPS, not words the walker said. Never read them out.
Use them to guide at the right moment: tell the walker about a turn shortly before it, using the landmark, never metres alone.
Point out one or two things worth remembering along the way, because they will walk back on their own later.
Between turns, stay quiet unless the walker talks to you. If the walker asks something, answer naturally.`;
}

const toRad = d => (d * Math.PI) / 180;
export function distance(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Tracks progress through the decision points and produces [NAV] facts.
export class Navigator {
  constructor(route) {
    this.turns = route.decisions;
    this.next = 0;
    this.lastMoved = Date.now();
    this.last = null;
  }

  update(pos) {
    if (this.last && distance(this.last, pos) > 3) this.lastMoved = Date.now();
    this.last = pos;
    const turn = this.turns[this.next];
    if (!turn) return { done: true, text: '[NAV] The walker has arrived at the destination.' };
    const d = Math.round(distance(pos, turn));
    if (d < 15 && this.next < this.turns.length) this.next++;
    const still = Math.round((Date.now() - this.lastMoved) / 1000);
    const mark = turn.landmark ? ` at ${turn.landmark.name}` : turn.tmapLandmark ? ` at ${turn.tmapLandmark}` : '';
    return {
      distance: d,
      still,
      text: `[NAV] Next: ${turn.action}${mark}, ${d} m ahead (turn ${this.next + 1} of ${this.turns.length}). GPS accuracy ±${Math.round(pos.accuracy)} m. Standing still for ${still} s.`,
    };
  }
}
