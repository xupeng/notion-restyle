#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Notion with Restyle
# @raycast.mode silent

# Optional parameters:
# @raycast.icon 🎨
# @raycast.packageName Notion Restyle
# @raycast.description Start Notion with custom styles enabled

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
APPLY_SCRIPT="$PROJECT_ROOT/scripts/apply-macos.sh"

if [ ! -x "$APPLY_SCRIPT" ]; then
  printf 'Notion Restyle apply script is missing or not executable: %s\n' "$APPLY_SCRIPT" >&2
  exit 1
fi

exec "$APPLY_SCRIPT"
