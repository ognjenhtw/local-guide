// Which voice AIs the app can use. Pick one in Settings; each keeps its own key.
import { GeminiSession } from './gemini.js';
import { OpenAISession } from './openai.js';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini Live',
    models: ['gemini-3.8-live'],
    // A few of the prebuilt voices worth comparing for a relaxed, friendly guide.
    voices: ['Puck', 'Achird', 'Umbriel', 'Zubenelgenubi', 'Aoede', 'Sulafat', 'Kore', 'Charon'],
    Session: GeminiSession,
  },
  openai: {
    label: 'OpenAI Realtime (GPT)',
    models: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
    voices: ['marin', 'cedar', 'ash', 'ballad', 'coral', 'sage', 'verse'],
    Session: OpenAISession,
  },
};

export function createSession(provider, opts) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider ${provider}`);
  return new p.Session(opts);
}
