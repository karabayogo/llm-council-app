# LLM Council (v2)

A small, zero-dependency app that runs an **LLM Council** — based on Andrej Karpathy's idea —
where several models answer a question, anonymously rank each other, and a chairman synthesizes a
final answer. Every model is reached through **one Vercel AI Gateway key**.

This is the v2: tallied (Borda) rankings, role personas per seat, a consensus/dissent chairman,
and a live UI that streams every stage.

## Run it

Node 18+ (uses built-in `fetch` and `--env-file`). No `npm install` needed.

```bash
cp .env.example .env.local          # paste your Vercel AI Gateway key
npm start                           # = node --env-file=.env.local server.mjs
# open http://localhost:5050
```

Smoke-test the gateway connection only:

```bash
bash test-gateway.sh
```

## Files

| File | What it is |
|---|---|
| `config.mjs` | The roster (6 models + roles), the chairman, temp/token settings |
| `council.mjs` | The 3-stage orchestration: answers → anonymized ranking → Borda tally → chairman; with retry |
| `server.mjs` | Tiny HTTP + Server-Sent-Events server |
| `public/index.html` | The live UI (vanilla JS, renders each stage as it streams, markdown-rendered) |
| `eval.mjs` | First-pass eval: council vs. each single model, one judge |
| `eval2.mjs` | Hardened eval: independent referee, format control, objective grading, saves answers |
| `test-gateway.sh` | Connectivity check across the roster |

## Configure the council

Edit `config.mjs`:

```js
export const COUNCIL = [
  { model: 'openai/gpt-5.5',                role: 'first-principles generalist' },
  { model: 'deepseek/deepseek-v4-pro',      role: 'rigorous reasoner — shows the working' },
  { model: 'mistral/mistral-large-3',       role: 'skeptic / red-team' },
  { model: 'google/gemini-3.1-pro-preview', role: 'domain expert — prizes thoroughness' },
  { model: 'zai/glm-5.2',                   role: 'pragmatic builder' },
  { model: 'minimax/minimax-m3',            role: 'contrarian' },
];
export const CHAIRMAN = 'openai/gpt-5.5';   // synthesizes the final answer (a council member)
```

Swap any model by changing its string — the gateway routes it. The **eval referee** in `eval2.mjs`
(`anthropic/claude-opus-4.8`) is deliberately kept off the council so it never grades its own work.

## Eval — does the council actually beat a single model?

```bash
node --env-file=.env.local eval2.mjs    # writes eval-results.json
```

It runs each prompt through every single model *and* the full council, then an independent judge
blind-ranks them. In our run the council won only the broad design/synthesis question and lost the
focused ones — so a council earns its cost on synthesis, not on every decision.
