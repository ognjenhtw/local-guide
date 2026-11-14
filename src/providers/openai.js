// The guide's voice: OpenAI Realtime over WebRTC, used only as a voice. It hears the walker
// (turn detection + speech-to-text) and reads out the lines the mind writes, word for word.
// It never answers by itself (create_response: false), so it can't ramble, stack replies or
// stall with "let me check".
import { log } from '../log.js';

// USD per 1M tokens: [audio in, audio out, text in, text out] (developers.openai.com pricing).
const PRICES = {
  'gpt-realtime-2.1': [32, 64, 4, 24],
  'gpt-realtime-2.1-mini': [10, 20, 0.6, 2.4],
};
const TRANSCRIBE_PER_MIN = 0.003; // gpt-4o-mini-transcribe

// Measured 2026-11-14: with this, the mini voice read 5/5 lines exactly, first sound in ~0.4-0.8 s.
const READ = line => `You are the voice of Local, a relaxed, warm friend in their late twenties on the phone. Say the line below out loud, word for word, exactly as written: nothing before it, nothing after it, no changes. Sound natural and easy-going, like you mean it; smile where it's funny.\n\nLINE: ${line}`;

export class OpenAIVoice {
  constructor({ apiKey, model, voice, onSpeechStart = () => {}, onSpeechStop = () => {}, onUtterance = () => {}, onPlaying = () => {}, onCost = () => {} }) {
    Object.assign(this, { apiKey, model, voice, onSpeechStart, onSpeechStop, onUtterance, onPlaying, onCost });
    this.cost = 0;
    this.utt = null; // what's being said now
    this.generating = null; // the sentence the server is generating: { line, id }
    this.playing = false;
    this.ready = new Promise(resolve => { this.markReady = resolve; }); // lines wait for the connection
  }

  // Must be called from a tap so iOS lets the page use the microphone and play audio.
  async start() {
    if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.playsInline = true;
    document.body.appendChild(this.audio);

    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    // A key fetched while they looked at the route saves a round trip, if it's still fresh.
    const early = this.early && Date.now() - this.early.at < 20 * 60000 ? await this.early.secret.catch(() => null) : null;
    const secret = early || await this.clientSecret();
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = e => { this.audio.srcObject = e.streams[0]; this.audio.play().catch(() => {}); };
    pc.addTrack(this.mic.getAudioTracks()[0]);
    pc.onconnectionstatechange = () => log(`voice connection: ${pc.connectionState}`);
    this.dc = pc.createDataChannel('oai-events');
    const open = new Promise(resolve => { this.dc.onopen = resolve; });
    this.dc.onmessage = e => this.onEvent(JSON.parse(e.data));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
    });
    if (!res.ok) throw new Error(`OpenAI call failed: ${res.status} ${await res.text()}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await open;
    this.startedAt = Date.now();
    this.markReady();
    log(`voice connected (${this.model}, ${this.voice})`);
  }

  // Fetch the session key ahead of time (no microphone needed for this).
  prefetch() {
    this.early = { at: Date.now(), secret: this.clientSecret() };
    this.early.secret.catch(err => log('voice key prefetch failed:', err.message));
  }

  // A short-lived key for this session, so the real key is only used once per walk.
  async clientSecret() {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 1800 }, session: this.sessionConfig() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI key/session error: ${data.error?.message || res.status}`);
    return data.value;
  }

  sessionConfig() {
    return {
      type: 'realtime',
      model: this.model,
      instructions: 'You are a voice. You only ever say the exact line you are given, nothing else.',
      output_modalities: ['audio'],
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
          noise_reduction: { type: 'near_field' }, // earbud mic close to the mouth
          // The app decides when to answer (create_response: false) and cuts the voice itself
          // when the walker starts talking (interrupt_response: false + cut()).
          turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 350, create_response: false, interrupt_response: false },
        },
        output: { voice: this.voice },
      },
    };
  }

  send(event) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  onEvent(ev) {
    const gen = this.generating;
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.onSpeechStart();
        break;
      case 'input_audio_buffer.speech_stopped':
        this.onSpeechStop();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.onUtterance(ev.transcript || '');
        break;
      case 'conversation.item.input_audio_transcription.failed':
        this.onUtterance('');
        break;
      case 'response.created':
        if (gen && !gen.id) {
          gen.id = ev.response.id;
          if (gen.cancel) this.send({ type: 'response.cancel', response_id: gen.id }); // cut before it began
        }
        break;
      case 'output_audio_buffer.started':
        this.playing = true;
        clearTimeout(this.drainTimer);
        if (!this.playedOnce) { this.playedOnce = true; this.onPlaying(); }
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.playing = false;
        this.settle();
        break;
      case 'response.output_audio_transcript.done':
        if (gen && ev.response_id === gen.id && ev.transcript?.trim() !== gen.line.trim()) log('voice said differently:', ev.transcript);
        break;
      case 'response.done':
        this.addCost(ev.response?.usage);
        if (gen && ev.response?.id === gen.id) {
          clearTimeout(this.genTimer);
          this.generating = null;
          this.pump(); // the next sentence is generated while this one plays
          this.settle();
        }
        break;
      case 'error':
        log('voice error:', ev.error?.message || ev);
        if (gen && !gen.id) { clearTimeout(this.genTimer); this.generating = null; this.pump(); this.settle(); }
        break;
    }
  }

  // One thing the guide says, added sentence by sentence while the mind is still writing it.
  // Each sentence goes to the voice as soon as the previous one has been generated (well before
  // it has been played); the server then plays them back to back. Measured 2026-11-14 over
  // WebRTC: a natural ~0.4 s pause between sentences, no overlap.
  utterance() {
    if (this.utt && !this.utt.finished) this.finish(this.utt, { replaced: true });
    const u = { queue: [], ended: false, finished: false };
    u.done = new Promise(resolve => { u.resolve = resolve; });
    u.add = line => { if (!u.finished && line.trim()) { u.queue.push(line.trim()); this.pump(); } };
    u.end = () => { u.ended = true; this.settle(); return u.done; };
    this.utt = u;
    this.playedOnce = false;
    return u;
  }

  // Say one line (all at once).
  say(line) {
    const u = this.utterance();
    u.add(line);
    return u.end();
  }

  async pump() {
    await this.ready;
    const u = this.utt;
    if (!u || u.finished || this.generating || !u.queue.length) return;
    const line = u.queue.shift();
    this.generating = { line, id: null };
    // Nothing back from the server at all: skip this sentence rather than hang.
    this.genTimer = setTimeout(() => {
      if (this.generating?.line === line && !this.generating.id) { log('voice: no response to a line'); this.generating = null; this.pump(); this.settle(); }
    }, 6000);
    // Out of band: the line isn't added to the voice's own conversation (it has no use for
    // one), so each line costs only itself.
    this.send({ type: 'response.create', response: { conversation: 'none', output_modalities: ['audio'], instructions: READ(line), input: [], tool_choice: 'none' } });
  }

  // The utterance is over once everything is generated and the audio has finished playing.
  settle() {
    const u = this.utt;
    if (!u || u.finished || !u.ended || u.queue.length || this.generating) return;
    if (!this.playing) {
      // Audio may still be about to start: give it a moment before calling it done.
      clearTimeout(this.drainTimer);
      this.drainTimer = setTimeout(() => { if (!this.playing && this.utt === u) this.finish(u, {}); }, 1200);
    } else {
      clearTimeout(this.drainTimer);
      this.drainTimer = setTimeout(() => this.finish(u, {}), 40000); // never hang on a missing event
    }
  }

  finish(u, result) {
    if (u.finished) return;
    u.finished = true;
    clearTimeout(this.drainTimer);
    if (this.utt === u) this.utt = null;
    u.resolve(result);
  }

  // Stop talking now (the walker started speaking).
  cut() {
    const u = this.utt;
    if (u) u.queue = [];
    const gen = this.generating;
    if (gen) { if (gen.id) this.send({ type: 'response.cancel', response_id: gen.id }); else gen.cancel = true; }
    this.send({ type: 'output_audio_buffer.clear' });
    if (u) this.finish(u, { cut: true });
  }

  addCost(u) {
    const p = PRICES[this.model];
    if (!u || !p) return;
    const i = u.input_token_details || {}, o = u.output_token_details || {};
    this.cost += ((i.audio_tokens || 0) * p[0] + (o.audio_tokens || 0) * p[1] + (i.text_tokens || 0) * p[2] + (o.text_tokens || 0) * p[3]) / 1e6;
    this.onCost(this.totalCost());
  }

  // Speech-to-text runs the whole time the line is open.
  totalCost() {
    return this.cost + (this.startedAt ? (Date.now() - this.startedAt) / 60000 * TRANSCRIBE_PER_MIN : 0);
  }

  close() {
    this.cut();
    this.dc?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach(t => t.stop());
    this.audio?.remove();
  }
}
