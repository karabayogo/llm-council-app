// eval2.mjs — hardened discovery: judge PANEL + format control + objective grading.
//
//  • Judge panel: 2 independent judges (not council members, not the chairman) — majority rules.
//  • Format control: judge the council's FULL output AND its FINAL section only (plain prose).
//      If FULL ranks above FINAL, the structure is winning rank, not the substance (format bias).
//  • Ground-truth prompts are GRADED for correctness (YES/NO vs a key) — immune to format bias.
//  • Every answer is saved to eval-results.json so we can re-judge later without paying again.
//
//  Run:  node --env-file=.env.local eval2.mjs
import { COUNCIL, CHAIRMAN } from './config.mjs';
import { call, runCouncil } from './council.mjs';
import { writeFile } from 'node:fs/promises';

const JUDGES = ['anthropic/claude-opus-4.8']; // independent referee: NOT on the council, NOT the chairman
const BASELINES = [...new Set([...COUNCIL.map((s) => s.model), CHAIRMAN])];
const LBL = 'ABCDEFGHIJ'.split('');
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
const short = (m) => (m === 'COUNCIL' || m === 'COUNCIL-final' ? m : m.split('/')[1]);

const RANKED = [
  { tag: 'trade-off',     q: 'We have a 3-service app on one VM. Should we move to Kubernetes now, or wait? Give a clear recommendation and the reasoning.' },
  { tag: 'risk',          q: "We're about to give an autonomous AI agent write access to our production Postgres. What are the most important risks we're overlooking, and how do we mitigate them?" },
  { tag: 'coding/design', q: 'Design a multi-tenant data model for a SaaS where each tenant can define custom fields on their records. Recommend an approach and the trade-offs.' },
];
const GRADED = [
  { tag: 'reasoning', q: 'A cache has a 60% hit rate. A cache hit takes 1 ms; a cache miss takes 50 ms total. What is the average request latency? Give the number.', key: '20.6 ms  (0.6*1 + 0.4*50)' },
];

const finalOnly = (t) => {
  const m = t.match(/FINAL[^\n:]*:?\s*([\s\S]*?)(?=CONFIDENCE\s*:|$)/i);
  return (m ? m[1] : t).trim();
};
const soloPlain = (model, q) => call(model, [
  { role: 'system', content: 'You are a helpful expert. Give your best, most useful answer.' },
  { role: 'user', content: q },
]).catch((e) => `[error: ${e.message}]`);
async function councilFinal(q) { let f = ''; await runCouncil(q, (e) => { if (e.type === 'synthesis') f = e.content; }); return f; }

async function panelRank(q, cands) {
  const anon = cands.map((c, i) => `=== Answer ${LBL[i]} ===\n${c.text}`).join('\n\n');
  return Promise.all(JUDGES.map((j) => call(j, [
    { role: 'system', content: 'You are an impartial expert evaluator. Judge ONLY on correctness, completeness and real-world usefulness — never length or formatting.' },
    { role: 'user', content: `QUESTION:\n${q}\n\n${anon}\n\nRank ALL answers best to worst. Reply with ONLY the letters, comma-separated, best first.` },
  ]).then((o) => (o.match(/[A-J]/g) || []).filter((v, i, a) => a.indexOf(v) === i)).catch(() => [])));
}
async function panelGrade(q, key, cands) {
  const out = {};
  for (const c of cands) {
    const votes = await Promise.all(JUDGES.map((j) => call(j, [
      { role: 'system', content: 'You grade answer correctness strictly and concisely.' },
      { role: 'user', content: `QUESTION:\n${q}\n\nKNOWN CORRECT ANSWER: ${key}\n\nCANDIDATE:\n${c.text}\n\nIs the candidate's final numeric answer correct? Reply ONLY YES or NO.` },
    ]).then((o) => /\byes\b/i.test(o)).catch(() => false)));
    out[c.id] = votes.filter(Boolean).length;
  }
  return out;
}

const saved = { judges: JUDGES, council: COUNCIL.map((s) => s.model), chairman: CHAIRMAN, ranked: [], graded: [] };
console.log(`Panel: ${JUDGES.join(' + ')}\nBaselines: ${BASELINES.length} single models (incl. chairman alone)\n`);

for (const { tag, q } of RANKED) {
  console.log(`\n[${tag}] ${q.slice(0, 70)}…`);
  const [solos, full] = await Promise.all([Promise.all(BASELINES.map((m) => soloPlain(m, q))), councilFinal(q)]);
  const cands = shuffle([
    ...BASELINES.map((m, i) => ({ id: m, text: solos[i] })),
    { id: 'COUNCIL', text: full },
    { id: 'COUNCIL-final', text: finalOnly(full) },
  ]);
  const orders = await panelRank(q, cands);
  const idOrders = orders.map((o) => o.map((lab) => cands[LBL.indexOf(lab)]?.id));
  const rankOf = (id) => idOrders.map((o) => (o.indexOf(id) + 1) || cands.length);
  const rFull = rankOf('COUNCIL'), rFin = rankOf('COUNCIL-final');
  const winners = idOrders.map((o) => o[0]);
  saved.ranked.push({ tag, q, idOrders, full, finalOnly: finalOnly(full), solos: Object.fromEntries(BASELINES.map((m, i) => [m, solos[i]])) });
  console.log(`  judges' winners: ${winners.map(short).join(' , ')}`);
  console.log(`  COUNCIL(full)  ranks: [${rFull.join(', ')}]   COUNCIL(final-only) ranks: [${rFin.join(', ')}]   of ${cands.length}`);
  const majWin = winners.filter((w) => w === 'COUNCIL' || w === 'COUNCIL-final').length >= Math.ceil(JUDGES.length / 2);
  console.log(`  → ${majWin ? '✅ council variant won the panel' : '❌ a single model won'}`);
}

for (const { tag, q, key } of GRADED) {
  console.log(`\n[${tag}] ${q.slice(0, 70)}…  (correct: ${key})`);
  const [solos, full] = await Promise.all([Promise.all(BASELINES.map((m) => soloPlain(m, q))), councilFinal(q)]);
  const cands = [...BASELINES.map((m, i) => ({ id: m, text: solos[i] })), { id: 'COUNCIL', text: full }];
  const grades = await panelGrade(q, key, cands);
  saved.graded.push({ tag, q, key, grades, full, solos: Object.fromEntries(BASELINES.map((m, i) => [m, solos[i]])) });
  for (const c of cands) console.log(`  ${grades[c.id] === JUDGES.length ? '✅' : grades[c.id] > 0 ? '≈ ' : '❌'} ${short(c.id)}  (${grades[c.id]}/${JUDGES.length} judges say correct)`);
}

await writeFile(new URL('./eval-results.json', import.meta.url), JSON.stringify(saved, null, 2));
console.log(`\n${'='.repeat(56)}\nsaved full answers → eval-results.json (re-judge cheaply later)`);
