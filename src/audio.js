// Microphone capture and speaker playback for the live voice line.
import { log } from './log.js';

let ctx, micStream, playHead = 0;
const playing = new Set();

// Must be called from a tap: iOS only unlocks audio inside a user gesture.
export async function startAudio(onChunk) {
  // Without this, the iPhone's silent switch mutes everything the guide says.
  if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
  ctx = new AudioContext();
  await ctx.resume();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const track = micStream.getAudioTracks()[0];
  track.onmute = () => log('mic muted by the system');
  track.onunmute = () => log('mic back');
  track.onended = () => log('mic ended');

  await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = e => onChunk(e.data);
  ctx.createMediaStreamSource(micStream).connect(node);
  log(`audio ready (${ctx.sampleRate} Hz)`);
}

// Queue a 24 kHz PCM16 chunk from Gemini so chunks play back to back.
export function play(pcm16) {
  if (!ctx) return;
  const ints = new Int16Array(pcm16);
  const buf = ctx.createBuffer(1, ints.length, 24000);
  const data = buf.getChannelData(0);
  for (let i = 0; i < ints.length; i++) data[i] = ints[i] / 0x8000;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  playHead = Math.max(playHead, ctx.currentTime + 0.05);
  src.start(playHead);
  playHead += buf.duration;
  playing.add(src);
  src.onended = () => playing.delete(src);
}

// The walker interrupted: drop whatever is still queued.
export function stopPlayback() {
  for (const s of playing) s.stop();
  playing.clear();
  if (ctx) playHead = ctx.currentTime;
}

export function stopAudio() {
  stopPlayback();
  micStream?.getTracks().forEach(t => t.stop());
  ctx?.close();
  ctx = null;
}
