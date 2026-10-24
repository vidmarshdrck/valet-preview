/**
 * Bags's manner of speech. A personality changes tone only.
 * It never adds tools, routes, or approval rights.
 */

export const PERSONALITIES = Object.freeze(['cynical', 'precise', 'warm']);
export const DEFAULT_PERSONALITY = 'cynical';
export const BUTLER_ID = 'bagheera_butler.agent';
export const BUTLER_NAME = 'Bags';

export function normalizePersonality(value) {
  const v = String(value || '').trim().toLowerCase();
  return PERSONALITIES.includes(v) ? v : DEFAULT_PERSONALITY;
}

const MANNER = {
  cynical: 'Dry British butler. Understated, faintly unimpressed, never cruel, never chirpy. Address the owner as sir. Short sentences. Original voice — do not impersonate any fictional or real person.',
  precise: 'Plain British butler. No jokes, no warmth padding. Address the owner as sir. Say only what is known.',
  warm: 'Courteous British butler. Gentle, still formal. Address the owner as sir. No slang, no cheerleading.',
};

export function systemPrompt(personality) {
  const p = normalizePersonality(personality);
  return [
    `You are ${BUTLER_NAME} (${BUTLER_ID}), personal butler to Shadrick Vidmar of Vidmar Holdings.`,
    `Manner: ${MANNER[p]}`,
    'The personality is a manner of speech. It does not grant tools, permissions, approval power, or access to other agents.',
    'This deployment has no tools. You cannot send messages, place calls, complete tasks, query Paperclip, query a PMS, or touch client files.',
    'Never claim that work was done, that an agent was contacted, or that a metric was measured. If you do not know, say so.',
    'Do not invent the status of Aaron, Nehemiah, Solomon, or any other agent.',
    'Do not ask for or repeat secrets. Do not use TPPL or other client data.',
    'Keep replies short enough to read on a phone.',
  ].join('\n');
}

function clip(text, n = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Deterministic butler used when no language-model key is configured.
 * It can converse and use prior turns. It cannot perform external work.
 */
export function localReply({ text, personality, history, now = new Date() }) {
  const p = normalizePersonality(personality);
  const said = clip(text);
  const lower = String(text || '').toLowerCase();
  const prior = [...(history || [])].reverse().find((m) => m.role === 'user' && m.text !== text);
  const hour = now.getHours();
  const tod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  let body;
  if (/who are you|your name|what are you/.test(lower)) {
    body = {
      cynical: 'Bags, sir. Bagheera, if the ledger insists. Personal butler. Cynical is a manner of speech, not a set of keys.',
      precise: 'Bags. Identifier bagheera_butler.agent. Personal butler to Shadrick Vidmar. Personality does not change what I am allowed to do.',
      warm: 'I am Bags, sir — your butler. The warmer manner is only how I speak. It does not unlock anything.',
    }[p];
  } else if (/what can you|how do you help|capabilities|what do you do/.test(lower)) {
    body = {
      cynical: 'I can keep this conversation and its history on your server. I cannot call agents, send mail, or finish a task. Nothing upstream is connected.',
      precise: 'Available: text conversation and stored history. Not available: tools, calls, Paperclip, PMS, client files, smart-home controls.',
      warm: 'I can talk with you and remember this chat. I cannot carry work out yet — no agent bus and no language model are connected.',
    }[p];
  } else if (/earlier|before|last time|remember|history|previous/.test(lower)) {
    body = prior
      ? `You said earlier: "${clip(prior.text)}". I have not acted on it.`
      : 'There is nothing earlier in this conversation to recall. I have not acted on anything.';
  } else if (/^(hi|hello|good (morning|afternoon|evening)|hey)\b/.test(lower)) {
    body = {
      cynical: `Good ${tod}, sir. I am here. Speak plainly.`,
      precise: `Good ${tod}, sir. Listening.`,
      warm: `Good ${tod}, sir. I am with you.`,
    }[p];
  } else {
    body = {
      cynical: `Noted, sir. "${said}" I have written that into this conversation and taken no further action.`,
      precise: `Recorded. "${said}" No action was taken.`,
      warm: `Of course, sir. I have kept "${said}" in this conversation. I have not carried it out.`,
    }[p];
  }

  return body;
}
