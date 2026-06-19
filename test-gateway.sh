#!/usr/bin/env bash
# Quick connectivity + cross-provider council test for Vercel AI Gateway.
# Reads AI_GATEWAY_API_KEY from .env.local. Requires: curl, jq.
#   bash test-gateway.sh
set -euo pipefail
cd "$(dirname "$0")"

KEY=$(grep -oE 'vck_[A-Za-z0-9]+' .env.local)
BASE="https://ai-gateway.vercel.sh/v1"

# Verified council roster (different labs). Swap to *-instant / haiku / flash to cut cost.
MODELS=(
  "openai/gpt-5.1-thinking"
  "anthropic/claude-opus-4.8"
  "google/gemini-3-pro-preview"
  "xai/grok-4.3"
)

echo "=== auth check: GET /models ==="
n=$(curl -sS "$BASE/models" -H "Authorization: Bearer $KEY" | jq '.data | length')
echo "ok — $n models available"

echo "=== Stage-1 council call (parallel-equivalent) ==="
for m in "${MODELS[@]}"; do
  body=$(jq -n --arg model "$m" \
    '{model:$model, messages:[{role:"user",content:"In one short sentence, name one risk of API rate limiting."}], max_tokens:60}')
  resp=$(curl -sS -w "\n%{http_code}|%{time_total}s" "$BASE/chat/completions" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$body")
  meta=$(printf '%s' "$resp" | tail -1)
  text=$(printf '%s' "$resp" | sed '$d' | jq -r '.choices[0].message.content // .error.message // "?"' 2>/dev/null | tr '\n' ' ')
  printf "%-34s [%s]\n   %s\n" "$m" "$meta" "${text:0:180}"
done
