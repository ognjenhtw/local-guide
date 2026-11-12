// OpenAI Realtime over WebRTC: the browser streams the microphone and plays the
// guide's voice natively; events (tool calls, transcripts, usage) travel on a data channel.
import { log } from '../log.js';

// USD per 1M tokens: [audio in, audio out, text in, text out, cached in] (developers.openai.com pricing).
const PRICES = {
  'gpt-realtime-2.1': [32, 64, 4, 24, 0.4],
  'gpt-realtime-2.1-mini': [10, 20, 0.6, 2.4, 0.3],
};

export class OpenAISession {
  constructor({ apiKey, model, voice, instructions, tools, onToolCall, onTranscript, onCost }) {
    Object.assign(this, { apiKey, model, voice, instructions, tools, onToolCall, onTranscript, onCost });
    this.cost = 0;
    this.busy = false; // a response is being generated
    this.pendingSpeak = false;
  }

  // Must be called from a tap so iOS lets the page use the microphone and play audio.
  async start() {
    if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.playsInline = true;
    document.body.appendChild(this.audio);

    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const secret = await this.clientSecret();

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = e => { this.audio.srcObject = e.streams[0]; this.audio.play().catch(() => {}); };
    pc.addTrack(this.mic.getAudioTracks()[0]);
    pc.onconnectionstatechange = () => log(`OpenAI connection: ${pc.connectionState}`);

    this.dc = pc.createDataChannel('oai-events');
    const open = new Promise(resolve => { this.dc.onopen = resolve; });
    this.dc.onmessage = e => this.onEvent(JSON.parse(e.data));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
    });
    if (!res.ok) throw new Error(`OpenAI call failed: ${res.status} ${await res.text()}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await open;
    log(`OpenAI connected (${this.model}, voice ${this.voice})`);
  }

  // A short-lived key for this session, so the real key is only used once per walk.
  async clientSecret() {
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: this.model,
          instructions: this.instructions,
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
              noise_reduction: { type: 'near_field' }, // earbud mic close to the mouth
              // A higher threshold keeps street noise from counting as speech.
              turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 600 },
            },
            output: { voice: this.voice },
          },
          tools: this.tools.map(t => ({ type: 'function', ...t })),
          tool_choice: 'auto',
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI key/session error: ${data.error?.message || res.status}`);
    return data.value;
  }

  send(event) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  async onEvent(ev) {
    switch (ev.type) {
      case 'response.created':
        this.busy = true;
        break;
      case 'response.done':
        this.busy = false;
        this.addCost(ev.response?.usage);
        if (this.pendingSpeak) { this.pendingSpeak = false; this.send({ type: 'response.create' }); }
        break;
      case 'response.output_item.done': {
        const item = ev.item;
        if (item?.type !== 'function_call') break;
        let out;
        try { out = await this.onToolCall(item.name, JSON.parse(item.arguments || '{}')); } catch (e) { out = { error: e.message }; }
        this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(out) } });
        this.speakWhenFree();
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        this.onTranscript('walker', ev.transcript);
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.onTranscript('guide', ev.delta);
        break;
      case 'error':
        log('OpenAI error:', ev.error?.message || ev);
        break;
    }
  }

  // Asking for a reply while one is still being generated is an error, so wait for it to finish.
  speakWhenFree() {
    if (this.busy) this.pendingSpeak = true;
    else this.send({ type: 'response.create' });
  }

  addCost(u) {
    const p = PRICES[this.model];
    if (!u || !p) return;
    const i = u.input_token_details || {}, o = u.output_token_details || {};
    const cached = i.cached_tokens || 0;
    this.cost += ((i.audio_tokens || 0) * p[0] + (o.audio_tokens || 0) * p[1]
      + Math.max(0, (i.text_tokens || 0) - cached) * p[2] + (o.text_tokens || 0) * p[3] + cached * p[4]) / 1e6;
    this.onCost?.(this.cost);
  }

  // Facts for the guide, added as system notes. speak=true asks it to react (it may keep it short).
  sendFacts(text, speak = false) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    if (speak) this.speakWhenFree();
  }

  // Same conversation, new instructions: OpenAI can update a live session.
  async switchInstructions(instructions) {
    this.send({ type: 'session.update', session: { type: 'realtime', instructions } });
  }

  close() {
    this.dc?.close();
    this.pc?.close();
    this.mic?.getTracks().forEach(t => t.stop());
    this.audio?.remove();
  }
}
