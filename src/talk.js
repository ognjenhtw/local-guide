// Turn-taking: one speaker at a time. The walker's words and the app's moments (a turn coming
// up, arrival) go to the mind one batch at a time, and exactly one line comes back and is said.
// - The guide never talks over the walker: while they speak, nothing new starts.
// - If the walker keeps talking while the mind is still thinking, that answer is dropped and
//   everything they said is answered together.
// - If the walker starts talking while the guide speaks, the guide stops (barge-in).
// What went wrong with a request to Claude, in plain words.
export function explain(err) {
  const s = err.status, m = String(err.message || '');
  if (s === 401) return 'the Claude API key was not accepted. Paste it again in Settings.';
  if (s === 403) return 'this Claude API key is not allowed to use this model.';
  if (s === 400 && /credit|balance|billing/i.test(m)) return 'the Claude account has no credit left.';
  if (s === 404) return 'this Claude model was not found. Pick another one in Settings.';
  if (s === 429) return 'too many requests to Claude right now. Wait a moment.';
  if (s >= 500) return 'Claude is busy or down right now. Try again in a minute.';
  if (!s) return "the phone can't reach Claude (no internet, a VPN, or an ad/content blocker blocking api.anthropic.com).";
  return 'Claude refused the request.';
}

export class Talk {
  constructor({ voice, mind, context = () => ({}), onLine = () => {}, onNote = () => {}, log = () => {} }) {
    Object.assign(this, { voice, mind, context, onLine, onNote, log });
    this.heard = []; // what the walker said that hasn't been answered yet
    this.events = []; // app moments not handled yet: [{ text, key }]
    this.state = 'idle'; // idle | thinking | speaking
    this.listening = false; // the walker is speaking right now
    this.awaiting = 0; // bits of speech whose text hasn't arrived yet
    this.gate = Promise.resolve(); // lines wait here until the walk has really started
  }

  // Think ahead but don't speak yet (the opener is written while the walker looks at the route).
  hold() { this.gate = new Promise(resolve => { this.release = resolve; }); }

  walkerStarted() {
    this.listening = true;
    this.awaiting++;
    if (this.state === 'speaking') { this.voice.cut(); this.cutOff = true; }
    if (this.state === 'thinking' && this.abortable) this.abort?.();
  }

  // They paused. The text of what they said arrives a moment later (walkerSaid), and may even
  // arrive after they've started talking again, so answering waits for both.
  walkerStopped() {
    this.listening = false;
    this.kick();
  }

  walkerSaid(text) {
    this.awaiting = Math.max(0, this.awaiting - 1);
    const clean = (text || '').trim();
    if (clean.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) this.heard.push(clean); // ignore noise and lone "uh"
    this.kick();
  }

  // An app moment. With a key, a newer moment of the same kind replaces an unhandled older one.
  event(text, key) {
    if (key) this.events = this.events.filter(e => e.key !== key);
    this.events.push({ text, key });
    this.kick();
  }

  kick() {
    if (this.state !== 'idle' || this.listening || (!this.heard.length && !this.events.length)) return;
    clearTimeout(this.timer);
    if (this.awaiting > 0) {
      // Still waiting for the text of something they said; never wait forever for it.
      this.timer = setTimeout(() => { this.awaiting = 0; this.kick(); }, 4000);
      return;
    }
    // They have stopped and everything they said is transcribed: answer now.
    this.timer = setTimeout(() => this.run(), 0);
  }

  async run() {
    if (this.state !== 'idle' || this.listening || this.awaiting > 0 || (!this.heard.length && !this.events.length)) return;
    const heard = this.heard.splice(0), events = this.events.splice(0);
    this.state = 'thinking';
    const ctrl = new AbortController();
    this.abort = () => ctrl.abort();
    this.abortable = true;
    // The guide starts speaking on the first sentence while the mind writes the rest.
    let utter = null;
    const t0 = Date.now();
    const onSentence = sentence => {
      this.abortable = false; // it's being said: from here on the walker can only cut it off
      if (!utter) {
        this.state = 'speaking';
        utter = this.gate.then(() => { this.log('first sentence', { ms: Date.now() - t0 }); return this.voice.utterance(); });
      }
      utter.then(u => u.add(sentence));
    };
    try {
      const ctx = await this.context({ heard: heard.length > 0 });
      // History stays append-only (thinking blocks must not be edited), so a cut-off line is noted now.
      if (this.cutOff) { events.unshift({ text: 'Your last line got cut off: they started talking over you.' }); this.cutOff = false; }
      const ask = () => this.mind.turn({
        heard, events: events.map(e => e.text), ...ctx, signal: ctrl.signal, onSentence,
        onToolStart: () => { this.abortable = false; },
      });
      let result;
      try {
        result = await ask();
      } catch (err) {
        // Most failures are a dropped or overloaded request: try once more, quietly.
        if (ctrl.signal.aborted || utter) throw err;
        this.log('mind failed, retrying', `${err.status || ''} ${err.message}`);
        result = await ask();
      }
      const { say, ms } = result;
      this.log('mind', { ms, heard, events: events.map(e => e.text), say });
      if (utter) {
        const u = await utter;
        this.onLine(say);
        const r = await u.end();
        this.log('spoke', { ms: Date.now() - t0, cut: !!r?.cut });
        if (r?.cut) this.cutOff = true;
      }
    } catch (err) {
      if (ctrl.signal.aborted && !utter) {
        // They kept talking: answer it all together once they stop.
        this.heard.unshift(...heard);
        this.events.unshift(...events);
      } else {
        this.log('mind failed', `${err.status || ''} ${err.message}`);
        this.onNote(`The guide couldn't answer: ${explain(err)} [${err.status || 'no status'}: ${String(err.message).slice(0, 160)}]`);
        // Only when they actually said something does it ask them to repeat it; otherwise it stays quiet.
        if (utter) (await utter).end(); else if (heard.length) await this.speak("Sorry, I didn't catch that. Say it again?");
      }
    } finally {
      this.state = 'idle';
      this.abortable = false;
      this.kick();
    }
  }

  // A whole line at once (the fallback when the mind fails).
  async speak(line) {
    this.state = 'speaking';
    await this.gate;
    this.onLine(line);
    const r = await this.voice.say(line);
    if (r?.cut) this.cutOff = true;
  }
}
