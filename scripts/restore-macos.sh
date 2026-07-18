#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

discover_notion_app
require_macos_runtime

if [ ! -f "$STATE_PATH" ]; then
  printf 'Notion Restyle 当前没有活动状态。\n'
  exit 0
fi

port="$(state_field port)" || fail "state.json 不安全或已损坏。"
saved_notion_pid="$(state_field notionPid)" || fail "state.json 缺少 notionPid。"
saved_notion_started="$(state_field notionStartedAt)" || fail "state.json 缺少 notionStartedAt。"
saved_notion_exe="$(state_field notionExe)" || fail "state.json 缺少 notionExe。"
if verified_cdp_endpoint "$port"; then
  recorded_notion_matches "$saved_notion_pid" "$saved_notion_started" "$saved_notion_exe" \
    || fail "记录的 Notion 进程身份不匹配，拒绝操作 renderer。"
  "$NODE" "$INJECTOR" --remove --port "$port" --timeout-ms 5000 \
    || fail "无法确认 renderer 样式已移除。"
fi
stop_recorded_injector
notion_is_running && stop_notion
/bin/rm -f "$STATE_PATH"
launch_notion_normally
printf 'Notion Restyle 已恢复；Notion 已按正常模式启动。\n'
