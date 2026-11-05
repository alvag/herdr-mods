#!/bin/sh
# Prints OpenCode Go subscription usage as one JSON line and exits.
#
# Finds the OpenCode Go key the opencode CLI stored — the v2 SQLite
# credential table first, then legacy auth.json — and asks the Go usage
# API. The key only ever travels in the Authorization header: it is never
# printed, logged, or written anywhere.
#
# Exit: 0 = printed the API's JSON body (error bodies included),
# 127 = no OpenCode Go credentials on this machine,
# 1 = credentials found but the API could not be reached.
# Override with HERDR_USAGE_OPENCODE_DB, HERDR_USAGE_OPENCODE_AUTH,
# HERDR_USAGE_OPENCODE_URL.

DB="${HERDR_USAGE_OPENCODE_DB:-$HOME/.local/share/opencode/opencode.db}"
AUTH="${HERDR_USAGE_OPENCODE_AUTH:-$HOME/.local/share/opencode/auth.json}"
URL="${HERDR_USAGE_OPENCODE_URL:-https://opencode.ai/zen/go/v1/usage}"

KEY=""
# v2 CLI: credentials live in SQLite. Read-only, WAL-safe; failure falls through.
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB" ]; then
  row=$(sqlite3 -noheader "file:$DB?mode=ro" "SELECT value FROM credential WHERE integration_id='opencode-go' AND active=1 ORDER BY time_updated DESC LIMIT 1;" 2>/dev/null) \
    && KEY=$(printf '%s' "$row" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("key",""))' 2>/dev/null)
fi
# Older CLI: auth.json holds the key under "opencode-go" or "opencode".
if [ -z "$KEY" ] && [ -f "$AUTH" ]; then
  KEY=$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); e=a.get("opencode-go") or a.get("opencode") or {}; print(e.get("key","") if isinstance(e,dict) else "")' "$AUTH" 2>/dev/null)
fi
[ -n "$KEY" ] || exit 127

BODY=$(curl -sS -m 20 -H "Authorization: Bearer $KEY" "$URL" 2>/dev/null) || exit 1
[ -n "$BODY" ] || exit 1
printf '%s\n' "$BODY"
