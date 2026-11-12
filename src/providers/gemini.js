// Gemini Live: one bidirectional WebSocket carrying the walker's voice up
// and the guide's voice (plus transcripts) back.
import { log } from '../log.js';
import { startAudio, play, stopPlayback, stopAudio } from '../audio.js';

const URL_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const toB64 = buf => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

// Gemini expects schema types in upper case ("OBJECT", "STRING"…).
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = Array.isArray(s) ? [] : {};
  for (const [k, v] of Object.entries(s)) out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v);
  return out;
}

export class GeminiSession {
  constructor({ apiKey, model, voice, instructions, tools, search, onToolCall, onTranscript }) {
    Object.assign(this, { apiKey, model, voice, instructions, tools, search, onToolCall, onTranscript });
    this.handle = null; // session resumption handle: lets us reconnect without losing the conversation
    this.closed = false;
  }

  // Must be called from a tap: iOS only unlocks audio inside a user gesture.
  async start() {
    await startAudio(chunk => this.sendAudio(chunk));
    await this.connect();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${URL_BASE}?key=${this.apiKey}`);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ setup: this.setupMessage() }));
      ws.onmessage = async e => {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
        if (msg.setupComplete) {
          log('Gemini connected');
          resolve();
          this.onReady?.();
          this.onReady = null;
        }
        this.onMessage(msg);
      };
      ws.onerror = () => reject(new Error('Gemini connection failed'));
      ws.onclose = e => {
        log(`Gemini closed (${e.code}${e.reason ? ': ' + e.reason : ''})`);
        // Google ends each connection after ~10 minutes; resume where we left off.
        if (!this.closed) setTimeout(() => this.connect().catch(err => log('ERROR', err.message)), 500);
      };
    });
  }

  setupMessage() {
    return {
      model: `models/${this.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
      },
      systemInstruction: { parts: [{ text: this.instructions }] },
      tools: [
        { functionDeclarations: this.tools.map(t => ({ ...t, parameters: geminiSchema(t.parameters), behavior: 'BLOCKING' })) },
        // Facts about places. Not part of the free tier: with a free key the connection is refused.
        ...(this.search ? [{ googleSearch: {} }] : []),
      ],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          // Low sensitivity so street noise is less likely to count as speech.
          startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          silenceDurationMs: 700,
        },
      },
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this.handle ? { handle: this.handle } : {},
    };
  }

  onMessage(msg) {
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.handle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) log(`Gemini will reconnect in ${msg.goAway.timeLeft}`);
    if (msg.toolCall) this.answerTools(msg.toolCall.functionCalls);
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) stopPlayback();
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) play(fromB64(part.inlineData.data));
    }
    if (sc.inputTranscription?.text) this.onTranscript('walker', sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.onTranscript('guide', sc.outputTranscription.text);
  }

  async answerTools(calls) {
    const functionResponses = await Promise.all(calls.map(async fc => {
      let response;
      try { response = await this.onToolCall(fc.name, fc.args || {}); } catch (e) { response = { error: e.message }; }
      return { id: fc.id, name: fc.name, response };
    }));
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
  }

  sendAudio(pcm16) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: toB64(pcm16), mimeType: 'audio/pcm;rate=16000' } } }));
    }
  }

  // Facts for the guide. speak=false adds context silently; speak=true invites a reply,
  // which the model may still decline (proactive audio is always on for 3.8 Live).
  sendFacts(text, speak = false) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: speak } }));
    }
  }

  // New instructions mean a fresh conversation for Gemini: reconnect without the old
  // resumption handle while the microphone and speaker keep running.
  switchInstructions(instructions) {
    this.instructions = instructions;
    this.handle = null;
    stopPlayback();
    return new Promise(resolve => {
      this.onReady = resolve;
      this.ws.close(); // onclose reconnects with the new setup
    });
  }

  close() {
    this.closed = true;
    this.ws?.close();
    stopAudio();
  }
}
