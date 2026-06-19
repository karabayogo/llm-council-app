// config.mjs — LLM Council v2 roster
// Verified working via Vercel AI Gateway on 2026-06-16 (all seats returned HTTP 200).

export const COUNCIL = [
  { model: 'openai/gpt-5.5',                role: 'first-principles generalist' },
  { model: 'deepseek/deepseek-v4-pro',      role: 'rigorous reasoner — shows the working' },
  { model: 'mistral/mistral-large-3',       role: 'skeptic / red-team' },
  { model: 'google/gemini-3.1-pro-preview', role: 'domain expert — prizes thoroughness' },
  { model: 'zai/glm-5.2',                   role: 'pragmatic builder — favors the simplest shippable answer' },
  { model: 'minimax/minimax-m3',            role: 'contrarian — argues the under-considered option' },
];

// The Chairman synthesizes the council's final answer. It IS a council member (gpt-5.5) — like
// Karpathy's original, where the chairman sits on the council. The INDEPENDENT eval referee
// (Opus 4.8, set in eval2.mjs) is a different model that is not on the council, so the referee
// never grades its own work.
export const CHAIRMAN = 'openai/gpt-5.5';

// Roles ON for the demo (genuine diversity); OFF for the eval (clean apples-to-apples).
export const USE_ROLES = true;

// Generation settings (per request): deterministic, generous headroom for reasoning models.
export const GEN = { temperature: 0, maxOutputTokens: 8000 };

export const roleFor = (seat) =>
  USE_ROLES
    ? `You are on an LLM council. Your seat: the ${seat.role}. ` +
      `Answer the user in that character — your most thoughtful, focused take.`
    : 'You are on an LLM council. Give your best, most thoughtful answer.';
