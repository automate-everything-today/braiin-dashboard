#!/usr/bin/env bash
# Append a build-log entry from the command line.
# Used by Claude (and Rob) to keep feedback.build_log fresh as we ship.
#
# Usage:
#   scripts/log-build-item.sh "<title>" <type> [area] [tags csv] [notes]
# Example:
#   scripts/log-build-item.sh "Wired /dev/quote-inbox to live drafts" wiring quoting "drafts,wired" "Inbox now reads quotes.drafts on mount"
#
# Honours commit context: pulls latest commit SHA + message automatically.

set -euo pipefail

TITLE="${1:?title required}"
TYPE="${2:-feature}"
AREA="${3:-}"
TAGS_CSV="${4:-}"
NOTES="${5:-}"

SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")

# Build tags JSON array
if [[ -z "$TAGS_CSV" ]]; then
  TAGS_JSON='[]'
else
  TAGS_JSON=$(printf '%s' "$TAGS_CSV" | python3 -c '
import sys, json
print(json.dumps([t.strip() for t in sys.stdin.read().split(",") if t.strip()]))
')
fi

PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'title': '''${TITLE//\'/\\\'}''',
  'item_type': '${TYPE}',
  'area': '${AREA}' or None,
  'tags': ${TAGS_JSON},
  'notes': '''${NOTES//\'/\\\'}''' or None,
  'commit_sha': '${SHA}' or None,
  'commit_message': '''${MSG//\'/\\\'}''' or None,
  'author': 'pair',
}))
")

BASE="${BUILD_LOG_BASE:-https://braiin.app}"
echo "POST $BASE/api/build-log"
curl -s -X POST "$BASE/api/build-log" \
  -H "content-type: application/json" \
  -d "$PAYLOAD" \
  -b ~/.claude/braiin-session-cookie.txt 2>/dev/null \
  -c ~/.claude/braiin-session-cookie.txt 2>/dev/null \
  | python3 -m json.tool
