import { localReply, normalizePersonality, systemPrompt } from './personalities.js';

const MAX_TEXT = 4096;
const HISTORY_LIMIT = 30;

export function clipText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

/**
 * Produce Bags's next line.
 * A configured model is called as-is. If that call fails, this returns an error
 * rather than inventing a successful reply. With no key, the local butler speaks.
 */
export async function completeTurn({ text, personality, history, env, fetchImpl, signal }) {
  const p = normalizePersonality(personality);
  const cleaned = clipText(text);
  if (!cleaned) return { error: 'empty' };
  const prior = (history || []).slice(-HISTORY_LIMIT);
  const key = env?.VALET_LLM_API_KEY || '';
  if (!key) {
    return { text: localReply({ text: cleaned, personality: p, history: prior }), provider: 'local-butler', personality: p };
  }
  const base = (env.VALET_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.VALET_LLM_MODEL || 'gpt-4o-mini';
  const fetchFn = fetchImpl || fetch;
  let res;
  try {
    res = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt(p) },
          ...prior.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
          { role: 'user', content: cleaned },
        ],
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return { error: 'interrupted' };
    return { error: 'provider_unavailable' };
  }
  if (!res.ok) return { error: 'provider_unavailable' };
  let data;
  try { data = await res.json(); } catch { return { error: 'provider_unavailable' }; }
  const out = data?.choices?.[0]?.message?.content;
  if (typeof out !== 'string' || !out.trim()) return { error: 'provider_unavailable' };
  return { text: out.trim().slice(0, MAX_TEXT), provider: 'openai-compatible', personality: p };
}

export function providerStatus(env) {
  const key = env?.VALET_LLM_API_KEY || '';
  if (!key) return { name: 'local-butler', state: 'ready', capabilities: { text: true, voice: false } };
  return { name: 'openai-compatible', state: 'ready', capabilities: { text: true, voice: false } };
}
