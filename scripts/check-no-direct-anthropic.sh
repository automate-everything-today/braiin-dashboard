#!/usr/bin/env bash
#
# CI guard: ensure no code outside src/lib/llm-gateway/ talks
# directly to Anthropic's Messages API.
#
# Why: every Braiin LLM call should flow through the gateway so we
# get token metering, content-hash cache, time-saved tracking, and
# multi-provider readiness. Without this guard, future code can
# silently bypass the gateway and we lose visibility.
#
# Allowed exceptions:
#   - src/lib/llm-gateway/**         the gateway itself
#   - src/lib/classify-batch.ts      uses Batch API (/v1/messages/batches),
#                                    out of scope for the synchronous gateway
#                                    until the gateway grows batch support
#
# Run locally: bash scripts/check-no-direct-anthropic.sh
# Run in CI:   npm run check:no-direct-anthropic

set -euo pipefail

cd "$(dirname "$0")/.."

# grep returns 1 when nothing matches - we WANT nothing to match.
# Capture matches first; fail if any survive the allowlist.
matches=$(
    grep -rn "https://api\.anthropic\.com" src \
        --include="*.ts" --include="*.tsx" \
        2>/dev/null \
        | grep -v "src/lib/llm-gateway/" \
        | grep -v "src/lib/classify-batch.ts" \
        || true
)

if [ -n "$matches" ]; then
    echo "FAIL: direct api.anthropic.com call found outside src/lib/llm-gateway/" >&2
    echo "" >&2
    echo "Offending references:" >&2
    echo "$matches" >&2
    echo "" >&2
    echo "Fix: import from '@/lib/llm-gateway' and call complete() instead of fetch()." >&2
    echo "See src/app/api/classify-email/route.ts for a reference migration." >&2
    exit 1
fi

echo "OK: all Anthropic Messages API calls go through src/lib/llm-gateway/"
