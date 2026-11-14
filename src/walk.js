// One walk: the route, the tracker, the mind and the turn-taking, and what the app tells the
// mind as the walker moves (a turn coming up, off the route, arrival). No page code here, so the
// rehearsal scripts run exactly this.
import { Navigator, routeBrief, placeText } from './guide.js';
import { Mind } from './mind.js';
import { Talk } from './talk.js';
import { streetsAround, frontOf } from './osm.js';
import { distance, bearing, compass } from './geo.js';

// Openers start from a different direction each walk, so they don't all sound alike. All of
// them low-key: a friend picking up the phone, not a comedian.
const ANGLES = [
  'ask what they are getting', 'a short casual reaction to the place', 'ask if they have been there before',
  'a small, dry tease about their choice, only if it comes naturally', 'ask what made them pick it',
  'guess what they will get, casually',
];

export class Walk {
  // deps: { buildRoute, findNear, placesNear, surroundingTypes, saveLandmark, saveInterest }
  constructor({ voice, apiKey, model, start, route, profile = {}, deps, log = () => {}, onLine = () => {}, onNote = () => {}, onRoute = () => {}, onPhase = () => {} }) {
    Object.assign(this, { voice, start, deps, profile, log, onRoute, onPhase });
    this.phase = 'there';
    this.nav = new Navigator(route, (route.personal || []).slice());
    this.mind = new Mind({ apiKey, model, log, handlers: this.tools() });
    this.talk = new Talk({ voice, mind: this.mind, log, onLine, onNote, context: ctx => this.context(ctx) });
    this.announced = new Set();
    this.offCount = 0;
    this.lastFix = 0;
    this.setRoute(route, false);
  }

  // The walk starts: the opener, nothing else.
  begin(startFix, pastOpeners = []) {
    this.nav.update(startFix);
    this.refreshAround();
    // They start right at the first turn: the first direction comes in the conversation.
    if ((this.nav.route.startLeg?.distance ?? 0) < 40) this.announced.add(0);
    const dest = this.nav.route.dest;
    const reliable = startFix.fixed || startFix.accuracy <= 25;
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
    this.talk.event([
      `The walk just started: they picked ${dest.name}${dest.kind ? ` (${dest.kind})` : ''}. For your opener: ${angle}.`,
      pastOpeners.length ? `Openers you've used on earlier walks, so do something clearly different: ${pastOpeners.map(o => `"${o}"`).join(' / ')}.` : '',
      reliable ? 'Their position is reliable.' : 'GPS is poor right now, so later you will ask what they see.',
    ].filter(Boolean).join(' '), 'start');
  }

  extra() {
    const { likes = [] } = this.profile;
    const mine = this.nav.personal;
    return [
      likes.length ? `They like: ${likes.join(', ')}.` : '',
      mine.length ? `Their own landmarks near this route: ${mine.map(m => `"${m.label}"${m.note ? ` (${m.note})` : ''}`).join('; ')}.` : '',
    ].filter(Boolean).join('\n');
  }

  setRoute(route, replanned = true) {
    this.nav.setRoute(route);
    this.mind.setScene({ phase: this.phase, brief: routeBrief(route), extra: this.extra() });
    if (replanned) this.announced = new Set([0]); // the first direction from here comes with the reply
    this.onRoute(route);
    // Shops along the way arrive a moment later on a quick re-plan.
    route.more?.then(() => { if (this.nav.route === route) this.mind.setScene({ brief: routeBrief(route) }); });
  }

  // What the mind gets with every turn: where they are, and what's around them when they spoke.
  async context({ heard }) {
    return { status: this.nav.status(this.phase), around: heard ? await this.around() : '' };
  }

  // What's around them, kept fresh in the background as they move, so nobody waits for it.
  async around() {
    const pos = this.nav.pos;
    if (this.aroundCache && distance(this.aroundCache.pos, pos) < 25) return this.aroundCache.text;
    return this.refreshAround();
  }

  refreshAround() {
    const pos = this.nav.pos;
    if (this.aroundLoading && distance(this.aroundLoading.pos, pos) < 25) return this.aroundLoading.promise;
    const promise = this.deps.placesNear(pos, 80, this.deps.surroundingTypes, 15).catch(() => []).then(places => {
      const mine = this.nav.personal.filter(m => distance(pos, m) < 80).map(m => `- their own landmark "${m.label}", ${Math.round(distance(pos, m))} m ${compass(bearing(pos, m))}`);
      const text = [...places.map(p => `- ${placeText(p)}, ${Math.round(distance(pos, p))} m ${compass(bearing(pos, p))}`), ...mine].join('\n') || '(nothing listed)';
      this.aroundCache = { pos, text };
      return text;
    });
    this.aroundLoading = { pos, promise };
    return promise;
  }

  // --- Tools the mind can call -----------------------------------------------------------------
  tools() {
    const near = (terms, radius, limit, from = this.nav.pos) => this.deps.findNear(from, terms || [], radius, limit);
    return {
      locate: async ({ search_terms, side }) => {
        const from = this.nav.raw || this.nav.pos;
        const found = await near(search_terms, 800, 6, from);
        if (!found.length) return { found: false, note: 'Nothing by that name near them. Ask for one other thing they can see right now, in one short question.' };
        const p = found[0]; // nearest to them
        // Passing it on their left/right: they're on the street beside it, on its side of the
        // street, facing along it. Otherwise ("in front of", "at"): plan from the place itself,
        // and TMAP finds the nearest pavement.
        const ways = side === 'left' || side === 'right' ? await streetsAround([p, from]).catch(() => null) : null;
        const spot = ways && frontOf(ways, p, side);
        const moved = this.nav.setLocation(spot ? spot.point : p, spot?.facing ?? null);
        this.lastFix = Date.now();
        this.offCount = 0;
        this.aroundCache = null;
        this.aroundLoading = null;
        const fresh = await this.deps.buildRoute(this.nav.pos, this.nav.route.dest, { quick: true, personal: this.nav.personal, likes: this.profile.likes });
        this.setRoute(fresh);
        this.log('located', { place: p.name, moved_m: moved, facing: spot?.facing ?? null });
        return {
          found: true, they_are_at: placeText(p), phone_location_was_m_away: moved, status: this.nav.status(this.phase),
          note: `THE ROUTE is now planned from right there (see the new route). Give them the first direction from there.${moved > 150 ? ' Their phone had put them somewhere else: you can mention that in a few words ("huh, your phone had you a bit further off"), then carry on.' : ''}`,
        };
      },
      go_their_way: async ({ search_terms }) => {
        const found = (await near(search_terms, 600, 6)).filter(p => distance(this.nav.pos, p) > 40);
        if (!found.length) return { found: false, note: 'Not found further along; ask them where it is.' };
        const before = this.nav.remaining();
        const theirs = await this.deps.buildRoute(this.nav.pos, this.nav.route.dest, { via: [found[0]], quick: true, personal: this.nav.personal, likes: this.profile.likes });
        this.setRoute(theirs);
        return { their_way: placeText(found[0]), longer_by_m: theirs.distance - before, note: 'Their way is THE ROUTE now. Say how it compares (no numbers) and the first bit.' };
      },
      find_nearby: async ({ search_terms }) => {
        const found = await near(search_terms, 500, 5);
        return found.length
          ? { places: found.map(p => `${placeText(p)}, ${Math.round(distance(this.nav.pos, p))} m ${compass(bearing(this.nav.pos, p))} of them`) }
          : { places: [], note: 'Nothing like that nearby.' };
      },
      remember_landmark: async ({ label, search_terms, note }) => {
        const place = search_terms?.length ? (await near(search_terms, 200, 1))[0] : null;
        const total = this.nav.remember({ label, place, note }, lm => this.deps.saveLandmark(lm));
        return { saved: true, at: place ? placeText(place) : 'where they are now', landmarks_on_their_map: total };
      },
      note_interest: ({ interest }) => {
        this.profile.likes = this.deps.saveInterest(interest);
        this.mind.setScene({ extra: this.extra() });
        return { saved: true, their_interests: this.profile.likes };
      },
      start_way_back: async () => {
        if (this.phase !== 'there') return { note: 'Already on the way back.' };
        await this.headBack();
        return { switched: true, note: 'You are now on the way back and they lead. Hand over in one short, casual line; no directions.' };
      },
    };
  }

  // --- The walker moves ------------------------------------------------------------------------
  async position(raw) {
    const nav = this.nav;
    nav.update(raw);
    if (!this.aroundCache || distance(this.aroundCache.pos, nav.pos) >= 25) this.refreshAround();
    const acc = nav.pos.accuracy;
    if (nav.arrived()) {
      if (!this.arrivedSaid) {
        this.arrivedSaid = true;
        this.talk.event(this.phase === 'there' ? 'They have arrived: they are right at the destination now.' : 'They made it back to the start on their own.', 'arrive');
      }
      return;
    }
    // Only trust GPS for moments like these when it's decent and they're actually walking.
    const walking = acc <= 30 && nav.stillFor() < 20;
    if (this.phase === 'there' && walking) {
      const i = nav.next, t = nav.turns[i];
      if (t && !this.announced.has(i) && distance(nav.pos, t) < Math.max(35, acc)) {
        this.announced.add(i);
        const f = nav.route.features?.[i] || {};
        this.talk.event(`They're getting close to turn ${i + 1}${f.rotary ? ` (${f.rotary})` : ''}. Tell them what to do there, in one breath.`, 'turn');
      }
    }
    // Off the route: twice in a row, with good GPS, not right after a position fix.
    const off = acc <= 25 && nav.offRoute() > Math.max(40, acc * 1.5) && Date.now() - this.lastFix > 25000 && walking;
    this.offCount = off ? this.offCount + 1 : 0;
    if (this.offCount >= 2 && !this.replanning) {
      this.offCount = 0;
      this.lastFix = Date.now();
      if (this.phase === 'there') {
        this.replanning = true;
        try {
          const fresh = await this.deps.buildRoute(nav.pos, nav.route.dest, { quick: true, personal: nav.personal, likes: this.profile.likes });
          this.setRoute(fresh);
          this.talk.event("They walked off the route. THE ROUTE is re-planned from where they are now: tell them casually, and the way from here.", 'off');
        } finally { this.replanning = false; }
      } else {
        this.talk.event("They're heading away from the way back.", 'off');
      }
    }
  }

  // Once the walk is really on: keep the guide's prompt cached through quiet stretches.
  live() {
    this.warmTimer = setInterval(() => { if (this.talk.state === 'idle') this.mind.keepWarm(); }, 30000);
  }

  close() {
    clearInterval(this.warmTimer);
  }

  // The turnover: a fresh route back to the start, and the mind switches roles.
  async headBack() {
    if (this.phase !== 'there') return;
    this.phase = 'back';
    const raw = this.nav.raw || this.nav.pos, correction = this.nav.correction;
    const back = await this.deps.buildRoute(this.nav.pos, { ...this.start, name: this.start.label || 'where they started' }, { quick: true, personal: this.nav.personal, likes: this.profile.likes });
    const personal = this.nav.personal;
    this.nav = new Navigator(back, personal);
    this.nav.correction = correction; // keep the walker's own position fix
    this.nav.update(raw);
    this.arrivedSaid = false;
    this.offCount = 0;
    this.mind.setScene({ phase: 'back' });
    this.setRoute(back, false);
    this.onPhase('back');
  }
}
