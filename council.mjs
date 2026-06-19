// council.mjs — the 3-stage council orchestration (raw fetch → Vercel AI Gateway).
import { COUNCIL, CHAIRMAN, GEN, roleFor } from './config.mjs';

const BASE = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const KEY = process.env.AI_GATEWAY_API_KEY;
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// call() with retry: transient network failures ("fetch failed"), 429s, and 5xx are retried
// up to 3 attempts with backoff — the long chairman call is the most failure-prone.
export async function call(model, messages, attempt = 0) {
  try {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages,
        temperature: GEN.temperature,
        max_tokens: GEN.maxOutputTokens,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if ((r.status === 429 || r.status >= 500) && attempt < 2) {
        await sleep(900 * (attempt + 1));
        return call(model, messages, attempt + 1);
      }
      throw new Error(data?.error?.message || `HTTP ${r.status}`);
    }
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    if (attempt < 2 && /fetch failed|network|ECONNRESET|terminated|timeout/i.test(String(e.message))) {
      await sleep(900 * (attempt + 1));
      return call(model, messages, attempt + 1);
    }
    throw e;
  }
}

// runCouncil drives all three stages, pushing live events through emit().
export async function runCouncil(query, emit) {
  if (!KEY) { emit({ type: 'fatal', error: 'AI_GATEWAY_API_KEY not set' }); return; }
  emit({ type: 'start', query, seats: COUNCIL.map((s) => ({ model: s.model, role: s.role })) });

  // ---- Stage 1: every seat answers, in parallel ----
  emit({ type: 'stage', stage: 1 });
  const answers = await Promise.all(COUNCIL.map(async (seat, i) => {
    emit({ type: 'seat_status', i, status: 'thinking' });
    const t0 = Date.now();
    try {
      const content = await call(seat.model, [
        { role: 'system', content: roleFor(seat) },
        { role: 'user', content: query },
      ]);
      emit({ type: 'answer', i, model: seat.model, role: seat.role, content, ms: Date.now() - t0 });
      return { i, seat, content, ok: true };
    } catch (e) {
      emit({ type: 'seat_error', i, model: seat.model, error: String(e.message) });
      return { i, seat, content: '', ok: false };
    }
  }));

  const live = answers.filter((a) => a.ok);
  if (live.length < 2) { emit({ type: 'fatal', error: 'not enough members answered' }); return; }
  const labeled = live.map((a, idx) => ({ ...a, label: LABELS[idx] }));
  const labelMap = Object.fromEntries(labeled.map((a) => [a.label, a.seat.model]));

  // ---- Stage 2: anonymized peer ranking ----
  emit({ type: 'stage', stage: 2 });
  emit({ type: 'labels', map: labelMap });
  const anon = labeled.map((a) => `=== Response ${a.label} ===\n${a.content}`).join('\n\n');
  const rankings = await Promise.all(labeled.map(async (a) => {
    emit({ type: 'rank_status', label: a.label, status: 'ranking' });
    try {
      const out = await call(a.seat.model, [
        { role: 'system', content: 'You rank AI responses objectively on accuracy and insight. Output only ordered letters.' },
        { role: 'user', content:
          `Question:\n${query}\n\nAnonymous responses:\n\n${anon}\n\n` +
          `Rank ALL responses best-to-worst. Reply with ONLY the letters, comma-separated, best first. Example: B,A,D,C` },
      ]);
      const order = (out.match(/[A-F]/g) || []).filter((v, i, arr) => arr.indexOf(v) === i);
      emit({ type: 'ranking', voter: a.label, model: a.seat.model, order });
      return { voter: a.label, order };
    } catch (e) {
      emit({ type: 'ranking', voter: a.label, model: a.seat.model, order: [], error: String(e.message) });
      return { voter: a.label, order: [] };
    }
  }));

  // ---- Borda tally (self-votes excluded) ----
  const n = labeled.length;
  const score = Object.fromEntries(labeled.map((a) => [a.label, 0]));
  rankings.forEach((r) => r.order.forEach((lab, pos) => {
    if (score[lab] !== undefined && lab !== r.voter) score[lab] += (n - 1 - pos);
  }));
  const leaderboard = labeled
    .map((a) => ({ label: a.label, model: a.seat.model, role: a.seat.role, score: score[a.label] }))
    .sort((x, y) => y.score - x.score);
  emit({ type: 'leaderboard', leaderboard });

  // ---- Stage 3: chairman synthesis (consensus + dissent) ----
  emit({ type: 'stage', stage: 3 });
  emit({ type: 'chair_status', model: CHAIRMAN, status: 'synthesizing' });
  const reveal = labeled.map((a) => `=== ${a.label} (${a.seat.model}) ===\n${a.content}`).join('\n\n');
  const rankSummary = rankings.map((r) => `${r.voter}: ${r.order.join(' > ') || '(none)'}`).join('\n');
  const synthesis = await call(CHAIRMAN, [
    { role: 'system', content: 'You are the Chairman of an LLM council. Synthesize a definitive answer and be honest about disagreement.' },
    { role: 'user', content:
      `QUESTION:\n${query}\n\nMEMBER RESPONSES:\n${reveal}\n\nPEER RANKINGS:\n${rankSummary}\n\n` +
      `Borda leaderboard: ${leaderboard.map((l) => `${l.label}=${l.score}`).join(', ')}\n\n` +
      `Write the final answer in EXACTLY this format:\n` +
      `CONSENSUS:\n- <points the members agree on>\nDISSENT:\n- <where they disagreed or open questions>\n` +
      `FINAL:\n<the best synthesized answer>\nCONFIDENCE: <HIGH | MEDIUM | LOW>` },
  ]).catch((e) => `CONSENSUS:\nDISSENT:\nFINAL:\n[chairman error: ${e.message}]\nCONFIDENCE: LOW`);
  emit({ type: 'synthesis', model: CHAIRMAN, content: synthesis });
  emit({ type: 'done' });
}
