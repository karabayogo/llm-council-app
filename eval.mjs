// eval.mjs — discovery harness: find prompts where the COUNCIL beats the best SINGLE model.
//
// For each prompt:
//   1. baseline = each unique model answers the query PLAINLY (no role) — i.e. "a single model alone".
//   2. council  = the full council process → chairman's final answer.
//   3. judge    = an INDEPENDENT model (not a council member, not the chairman) blind-ranks all
//                 answers (baselines + council, shuffled, anonymized) on correctness/usefulness.
//   "Council wins" = the council's answer ranks above every single-model baseline.
//
// Run:  node --env-file=.env.local eval.mjs
import { COUNCIL, CHAIRMAN } from './config.mjs';
import { call, runCouncil } from './council.mjs';

const JUDGE = 'minimax/minimax-m3';           // independent: not in the council, not the chairman
const BASELINES = [...new Set([...COUNCIL.map((s) => s.model), CHAIRMAN])]; // every single model, incl. Opus

// Candidate prompts, tagged with the hypothesis for why a council might (or might not) help.
const PROMPTS = [
  { tag: 'breadth/risk',   q: "We're launching a payments feature next month. What are the most important risks we're probably overlooking, and how should we mitigate them?" },
  { tag: 'trade-off',      q: "Should a 5-person startup rewrite its Rails monolith into microservices? Give a clear recommendation with the reasoning." },
  { tag: 'control/simple', q: "Explain what a database index is and when you should add one." },
];

const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
const LABELS = 'ABCDEFGH'.split('');

async function soloPlain(model, q) {
  return call(model, [
    { role: 'system', content: 'You are a helpful expert. Give your best, most useful answer.' },
    { role: 'user', content: q },
  ]).catch((e) => `[error: ${e.message}]`);
}
async function councilFinal(q) {
  let final = '';
  await runCouncil(q, (e) => { if (e.type === 'synthesis') final = e.content; });
  return final;
}
async function judgeRank(q, cands) {
  const anon = cands.map((c, i) => `=== Answer ${LABELS[i]} ===\n${c.text}`).join('\n\n');
  const out = await call(JUDGE, [
    { role: 'system', content: 'You are an impartial expert evaluator. Judge on correctness, completeness, and real-world usefulness — NOT length or formatting.' },
    { role: 'user', content: `QUESTION:\n${q}\n\n${anon}\n\nRank ALL answers from best to worst. Reply with ONLY the letters, comma-separated, best first. Example: C,A,B` },
  ]);
  const order = (out.match(/[A-H]/g) || []).filter((v, i, a) => a.indexOf(v) === i);
  return order;
}

console.log(`Judge: ${JUDGE}  |  baselines: ${BASELINES.length} single models  |  prompts: ${PROMPTS.length}\n`);
const results = [];
for (const { tag, q } of PROMPTS) {
  process.stdout.write(`\n[${tag}] ${q}\n  running ${BASELINES.length} singles + council…\n`);
  const [solos, final] = await Promise.all([
    Promise.all(BASELINES.map((m) => soloPlain(m, q))),
    councilFinal(q),
  ]);
  const cands = shuffle([
    ...BASELINES.map((m, i) => ({ id: m, text: solos[i] })),
    { id: 'COUNCIL', text: final },
  ]);
  const order = await judgeRank(q, cands);
  const idOf = (lab) => cands[LABELS.indexOf(lab)]?.id ?? '?';
  const councilLab = LABELS[cands.findIndex((c) => c.id === 'COUNCIL')];
  const councilRank = order.indexOf(councilLab) + 1;
  const won = councilRank === 1;
  results.push({ tag, q, won, councilRank, n: cands.length, winner: idOf(order[0]), order: order.map(idOf) });
  console.log(`  winner: ${idOf(order[0])}`);
  console.log(`  COUNCIL ranked #${councilRank}/${cands.length}  →  ${won ? '✅ beat every single model' : '❌ a single model was better'}`);
  console.log(`  full order: ${order.map(idOf).join('  >  ')}`);
}

console.log(`\n${'='.repeat(60)}\nSUMMARY — where the council won:`);
for (const r of results) console.log(`  ${r.won ? '✅' : '❌'}  [${r.tag}] #${r.councilRank}/${r.n}  ${r.won ? '' : '(best: ' + r.winner + ')'}`);
console.log(`\nCouncil won ${results.filter((r) => r.won).length}/${results.length} prompts.`);
