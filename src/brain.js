// The "brain": a text model that answers the walker's navigation questions from the full route
// data. The voice model only says its answer, because live voice models are poor at working out
// routes themselves (they mix up steps and repeat themselves).
import Anthropic from '@anthropic-ai/sdk';

export const BRAINS = {
  claude: { label: 'Claude', models: ['claude-opus-5-5', 'claude-haiku-5-5'] },
  gemini: { label: 'Gemini (free tier, can be slow)', models: ['gemini-3.5-flash', 'gemini-3.8-flash'] },
};

let claude, claudeKey;

async function askClaude({ apiKey, model, system, prompt, signal }) {
  if (!claude || claudeKey !== apiKey) {
    // The key lives on the study phone only (typed into Settings), like the other keys.
    claude = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    claudeKey = apiKey;
  }
  const params = {
    model,
    max_tokens: 1024,
    // The instructions never change during a walk, so they can be cached between questions.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low' }, // short spoken answers: speed over depth
  };
  // Opus 5.5 can decline a request on safety grounds; let the server retry on its fallback model.
  const res = model === 'claude-opus-5-5'
    ? await claude.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : await claude.messages.create(params, { signal });
  if (res.stop_reason === 'refusal') throw new Error('the brain declined to answer');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

async function askGemini({ apiKey, model, system, prompt, signal }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
}

// Ask the brain; gives up after `timeoutMs` so the walker is never left in silence.
export async function askBrain({ provider, timeoutMs = 7000, ...opts }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const ask = provider === 'claude' ? askClaude : askGemini;
  return ask({ ...opts, signal });
}
