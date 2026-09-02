#!/usr/bin/env bash
# getUserMedia needs a secure context; http://localhost counts as one.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8000}"
echo "http://localhost:${PORT}/"
exec python3 -m http.server "$PORT"
