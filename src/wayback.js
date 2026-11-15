// The way back: "your turn to be the local". The walker leads, the guide follows. The app (not the
// AI) decides what support is given and when, so every participant gets the same rules, and every
// step is recorded for the research.
//
// - Asking: coming up to a turn, the guide asks "which way?" like a follower. After two turns in a
//   row done right without help it stops asking (it trusts their lead); any help turns it back on.
// - Help, in three steps per turn: 1 ask what they remember, 2 a landmark hint as the guide's own
//   memory, 3 the way at that turn. Asked for by the walker, or offered when they stand unsure.
// - Wrong way (getting farther from home, off the route): 1 doubt, 2 a hint, 3 the way back on
//   track. It never offers to lead; it leads only when the walker asks (a "rescue").
// - Their own way: at most two detours they ask for, each re-planned.
import { distance, side, destinationPoint } from './geo.js';
import { checkpointsOf } from './checkpoints.js';

const ASK_STREAK = 2; // turns done right without help before it stops asking
const HESITATE_S = 12; // standing still this long near a turn counts as unsure
const WRONG_ESCALATE_S = 40; // still the wrong way after this long: the next step of support
export const MAX_DETOURS = 2;

export class WayBack {
  constructor({ say, log }) {
    Object.assign(this, { say, log });
    this.turns = []; // the record, one entry per turn met, in walking order
    this.asking = true;
    this.streak = 0;
    this.detours = 0;
    this.leading = false; // the walker asked the guide to lead
    this.mapOpens = 0;
    this.positionShown = 0;
    this.startedAt = Date.now();
    this.hesitateS = HESITATE_S;
    this.escalateMs = WRONG_ESCALATE_S * 1000;
  }

  // A (re-)planned route home: its turns become the ones being walked now.
  setRoute(route) {
    this.route = route;
    this.cps = checkpointsOf(route);
    this.byIndex = route.decisions.map((t, i) => this.entry(i));
    this.lastNext = 0;
    this.wrong = null;
    this.stillSince = null;
  }

  entry(i) {
    const cp = this.cps[i];
    const e = { turn: `${cp.title}${cp.sub ? ` ${cp.sub}` : ''}`, asked: false, help: 0, wrongWay: 0, outcome: null, at: null };
    this.turns.push(e);
    return e;
  }

  // What the guide may say at this turn for each help step (written by code from the route).
  helpFor(i) {
    const cp = this.cps[i] || this.cps.at(-1);
    const t = this.route.decisions[i];
    const prevShops = (i === 0 ? this.route.startLeg : this.route.decisions[i - 1]?.leg)?.shops || [];
    const before = prevShops.at(-1);
    const mark = cp.sub || (before ? `just after ${before.en || `${before.name} (${before.type})`} on the ${before.side}` : '');
    return {
      1: 'Ask them what they remember about this bit, or what they can see. No hint, no direction.',
      2: `A hint as your own memory, not the direction: ${mark ? `what marks this turn: ${mark}` : `this is where the way turns${t ? '' : ' into the last stretch'}`} ("wait, didn't we pass…?").`,
      3: `Tell them the way here, as your own memory ("pretty sure we…"): ${cp.title}${cp.sub ? ` ${cp.sub}` : ''}.`,
    };
  }

  // The walker asked for help, or stood unsure: the next step at the current turn.
  giveHelp(nav) {
    const i = Math.min(nav.next, this.byIndex.length - 1);
    const e = this.byIndex[i];
    if (!e) return { level: 3, say: 'Tell them home is right there.' };
    e.help = Math.min(3, e.help + 1);
    this.asking = true; // they needed help: ask again at the next turns
    this.streak = 0;
    this.log('way back: help', { turn: i + 1, level: e.help });
    return { level: e.help, say: this.helpFor(i)[e.help], note: 'Say it as their follower, in your own words, as your own memory; never as a teacher.' };
  }

  lead() {
    this.leading = true;
    const e = this.byIndex[Math.min(this.lastNext, this.byIndex.length - 1)];
    if (e) e.outcome = 'you asked me to lead';
    this.log('way back: rescue (asked the guide to lead)', {});
  }

  // Every GPS fix on the way back.
  onPosition(nav) {
    const acc = nav.pos.accuracy;
    const walking = acc <= 30 && nav.stillFor() < 20;
    // Turns passed since the last fix: how did each go?
    while (this.lastNext < nav.next) {
      const e = this.byIndex[this.lastNext];
      const n = this.lastNext + 1;
      this.lastNext++;
      if (!e || e.outcome) continue;
      e.at = Date.now();
      if (this.leading) { e.outcome = 'guided by me'; continue; }
      const alone = e.help === 0 && e.wrongWay === 0;
      e.outcome = alone ? 'on your own' : e.help ? `with help (step ${e.help})` : 'after a wrong turn';
      if (alone) {
        this.streak++;
        const fade = this.asking && this.streak >= ASK_STREAK;
        if (fade) this.asking = false;
        this.say(`They got turn ${n} right on their own.${fade ? " They clearly know this: from now on don't ask which way at turns, just follow them and chat." : ''} A short natural reaction, or nothing (${'<quiet>'}).`, 'passed');
      } else this.streak = 0;
    }
    const i = nav.next, t = nav.turns[i], e = this.byIndex[i];
    if (!t || !e) return;
    const near = distance(nav.pos, t) < Math.max(35, acc);
    // Leading (they asked): announce turns like on the way there.
    if (this.leading) {
      if (near && !e.asked) { e.asked = true; this.say(`You lead now: they're getting close to ${this.cps[i].title}${this.cps[i].sub ? ` ${this.cps[i].sub}` : ''}. Tell them what to do there, in one breath.`, 'turn'); }
      return;
    }
    // Coming up to a turn: ask which way, while still asking.
    if (near && walking && this.asking && !e.asked) {
      e.asked = true;
      this.say(`They're coming up to a turn (turn ${i + 1}). Ask them which way, as their follower, in a few words. Don't hint.`, 'turn');
    }
    // Standing still near the turn: they seem unsure.
    if (distance(nav.pos, t) < 45 && nav.stillFor() >= this.hesitateS && e.help < 3 && !this.hesitatedAt?.[i]) {
      (this.hesitatedAt ??= {})[i] = Date.now();
      this.say(`They've stopped near turn ${i + 1} and seem unsure. Call give_help and say what it gives you, lightly.`, 'unsure');
    }
    this.checkWrongWay(nav, e, walking);
  }

  // Off the route and getting farther from home: doubt, then a hint, then the way back on track.
  checkWrongWay(nav, e, walking) {
    const acc = nav.pos.accuracy;
    const home = this.route.dest;
    const now = Date.now();
    const off = acc <= 25 && nav.offRoute() > Math.max(40, acc * 1.5);
    this.homeTrail = (this.homeTrail || []).filter(h => now - h.t < 30000);
    this.homeTrail.push({ t: now, d: distance(nav.pos, home) });
    const away = this.homeTrail.length > 3 && this.homeTrail.at(-1).d - this.homeTrail[0].d > 15;
    if (!off) { if (this.wrong && nav.offRoute() < 25) { this.log('way back: back on track', {}); this.wrong = null; } return; }
    if (!walking || (!away && !this.wrong)) return;
    if (!this.wrong) {
      this.wrong = { level: 1, since: now };
      e.wrongWay++;
      this.streak = 0;
      this.asking = true;
      this.say("They're heading the wrong way, away from home. As their follower, voice doubt in a few words (\"hm, this doesn't look familiar…\"). No direction, no hint.", 'wrong');
      return;
    }
    if (now - this.wrong.since < this.escalateMs || this.wrong.level >= 3) return;
    this.wrong.level++;
    this.wrong.since = now;
    const i = Math.min(nav.next, this.cps.length - 1);
    const back = this.wayBackOnTrack(nav);
    this.say(this.wrong.level === 2
      ? `Still heading the wrong way. A hint as your own memory, not the full direction: ${back.hint}.`
      : `Still the wrong way. Tell them plainly how to get back on track, as a friend: ${back.way}, then ${this.cps[i].title}${this.cps[i].sub ? ` ${this.cps[i].sub}` : ''}. Don't offer to lead.`, 'wrong');
  }

  // Where the route is from where they stand, for the hint and the way back.
  wayBackOnTrack(nav) {
    let best = null, bestD = Infinity;
    for (const p of this.route.line) { const d = distance(nav.pos, p); if (d < bestD) { bestD = d; best = p; } }
    const h = nav.heading();
    const where = h ? side(nav.pos, h.deg, best) : null;
    const dir = { behind: 'back the way they just came', 'on the left': 'off to their left', 'on the right': 'off to their right', ahead: 'ahead of them', 'ahead on the left': 'ahead to their left', 'ahead on the right': 'ahead to their right' }[where] || 'back towards where they turned off';
    const cp = this.cps[Math.min(nav.next, this.cps.length - 1)];
    return {
      hint: `the way home is ${dir}${cp?.sub ? `, towards ${cp.sub.replace(/^(at|by) /, '')}` : ''} ("I'm pretty sure we came from over there")`,
      way: `the way home is ${dir}: go back to it`,
    };
  }

  // A detour they asked for: the via point (a place, or a direction from where they stand).
  detourPoint(nav, direction) {
    const h = nav.heading()?.deg ?? 0;
    const turn = { left: -90, right: 90, straight: 0, ahead: 0, back: 180 }[direction] ?? 0;
    return destinationPoint(nav.pos, (h + turn + 360) % 360, 60);
  }

  // What the walk back looked like, for the screen and the log.
  summary() {
    const turns = this.turns.filter(t => t.outcome || t.help || t.wrongWay);
    return {
      minutes: Math.round((Date.now() - this.startedAt) / 6000) / 10,
      turns: turns.map(t => ({ turn: t.turn, outcome: t.outcome || 'not reached', help: t.help, wrongWay: t.wrongWay })),
      alone: turns.filter(t => t.outcome === 'on your own').length,
      helpSteps: turns.reduce((s, t) => s + t.help, 0),
      wrongWays: turns.reduce((s, t) => s + t.wrongWay, 0),
      detours: this.detours,
      rescued: this.leading,
      mapOpens: this.mapOpens,
      positionShown: this.positionShown,
    };
  }
}
