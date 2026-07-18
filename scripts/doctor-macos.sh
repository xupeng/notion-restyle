#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

for file in \
  "$PROJECT_ROOT/.env.example" \
  "$PROJECT_ROOT/assets/notion-custom.css" \
  "$PROJECT_ROOT/assets/renderer-inject.js" \
  "$PROJECT_ROOT/scripts/injector.mjs"; do
  [ -f "$file" ] || fail "缺少文件：$file"
done

/usr/bin/grep -q 'fonts.googleapis.com' "$PROJECT_ROOT/assets/notion-custom.css" \
  || fail "CSS 缺少 Google Fonts import。"
/usr/bin/grep -q 'notion-page-content' "$PROJECT_ROOT/assets/notion-custom.css" \
  || fail "CSS 缺少 Notion 正文选择器。"
/usr/bin/grep -q '^NOTION_RESTYLE_PORT=' "$PROJECT_ROOT/.env.example" \
  || fail ".env.example 缺少 NOTION_RESTYLE_PORT。"

for script in "$PROJECT_ROOT"/*.command "$PROJECT_ROOT/scripts"/*.sh "$PROJECT_ROOT/raycast"/*.sh; do
  /bin/bash -n "$script"
done
discover_notion_app
require_macos_runtime
"$NODE" --check "$PROJECT_ROOT/scripts/injector.mjs"
printf 'PASS: Notion Restyle 文件、Shell、Node、Notion 签名元数据和 runtime 检查通过（%s）。\n' "$NODE_VERSION"
