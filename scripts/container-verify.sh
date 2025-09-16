#!/bin/bash
set -euo pipefail

echo "Container verify - checking essential runtime tools and files"

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "OK: $1 -> $(command -v $1)"
  else
    echo "MISSING: $1" >&2
    MISSING=1
  fi
}

MISSING=0
check_cmd npx || true
check_cmd uvx || true
check_cmd node || true
check_cmd python3 || true

echo "\nChecking important files in /app (as used by Dockerfile/startup.sh)"
[ -f /app/cli.js ] && echo "OK: /app/cli.js exists" || echo "MISSING: /app/cli.js" >&2 && MISSING=1
[ -d /app/src ] && echo "OK: /app/src exists" || echo "MISSING: /app/src" >&2 && MISSING=1
[ -f /app/config/mcp-servers.json ] && echo "OK: /app/config/mcp-servers.json exists" || echo "MISSING: /app/config/mcp-servers.json" >&2 && MISSING=1

echo "\nQuick sanity: node --version"
node --version || true
echo "python3 --version"
python3 --version || true

if [ "$MISSING" -ne 0 ]; then
  echo "\nOne or more checks failed. See MISSING lines above." >&2
  exit 2
fi

echo "\nAll checks passed. The container appears to have the required runtime tools and files." 
exit 0
