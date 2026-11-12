// The "brain": a text model that answers the walker's navigation questions from the full route
// data. The voice model only says its answer, because live voice models are poor at working out
// routes themselves (they mix up steps and repeat themselves).
import Anthropic from '@anthropic-ai/sdk';

export const BRAINS = {
  // Measured on a navigation question with the full route (2026-11-12): Sonnet 5.5 ~1 s to first
  // words; Haiku 5.5 faster but broke the naming rules; Opus 5.5 ~4 s to first words, too slow to talk.
  claude: { label: 'Claude', models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] },
  gemini: { label: 'Gemini (free tier, can be slow)', models: ['gemini-3.5-flash', 'gemini-3.8-flash'] },
};

// Per model: switch off thinking where the model allows it, for speed. Opus 5.5 can't, so it
// runs at low effort.
const CLAUDE_SPEED = {
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } },
  'claude-haiku-5-5': { thinking: { type: 'disabled' }, output_config: { effort: 'low' } },
  'claude-opus-5-5': { output_config: { effort: 'low' } },
};

let claude, claudeKey;

async function askClaude({ apiKey, model, system, context, prompt, signal }) {
  if (!claude || claudeKey !== apiKey) {
    // The key lives on the study phone only (typed into Settings), like the other keys.
    claude = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    claudeKey = apiKey;
  }
  const params = {
    model,
    max_tokens: 400, // short spoken answers
    ...CLAUDE_SPEED[model],
    // The rules and the route don't change between questions, so they're cached.
    system: [
      { type: 'text', text: system },
      { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: prompt }],
  };
  // Opus 5.5 may decline on safety grounds; let the server retry on its fallback model.
  const res = model === 'claude-opus-5-5'
    ? await claude.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : await claude.messages.create(params, { signal });
  if (res.stop_reason === 'refusal') throw new Error('the navigator declined to answer');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

async function askGemini({ apiKey, model, system, context, prompt, signal }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${system}\n\n${context}` }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
}

// Ask the brain; gives up after `timeoutMs` so the walker is never left in silence.
// `context` is what stays the same for a whole route (the route data); `prompt` is this question.
export async function askBrain({ provider, timeoutMs = 6000, ...opts }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const ask = provider === 'claude' ? askClaude : askGemini;
  return ask({ ...opts, signal });
}
