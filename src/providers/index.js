// The guide's voice. Only OpenAI Realtime can be told to read a given line word for word (and to
// never answer on its own), which is what this design needs; Gemini Live (gemini.js) always
// answers by itself, so it isn't offered for now.
import { OpenAIVoice } from './openai.js';

export const PROVIDERS = {
  openai: {
    label: 'OpenAI Realtime (voice only)',
    models: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
    voices: ['marin', 'cedar', 'ash', 'ballad', 'coral', 'sage', 'verse'],
  },
};

export function createVoice(opts) {
  return new OpenAIVoice(opts);
}
