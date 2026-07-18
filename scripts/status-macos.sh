#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

discover_notion_app
require_macos_runtime

if [ ! -f "$STATE_PATH" ]; then
  printf '状态：未启用\n'
  exit 0
fi

port="$(state_field port)" || fail "state.json 不安全或已损坏。"
injector_pid="$(state_field injectorPid)" || fail "state.json 缺少 injectorPid。"
injector_started="$(state_field injectorStartedAt)" || fail "state.json 缺少 injectorStartedAt。"
saved_node="$(state_field node)" || fail "state.json 缺少 node。"
saved_injector="$(state_field injector)" || fail "state.json 缺少 injector。"
saved_notion_pid="$(state_field notionPid)" || fail "state.json 缺少 notionPid。"
saved_notion_started="$(state_field notionStartedAt)" || fail "state.json 缺少 notionStartedAt。"
saved_notion_exe="$(state_field notionExe)" || fail "state.json 缺少 notionExe。"

verified_cdp_endpoint "$port" || fail "记录的端口不是当前 Notion 的 loopback CDP endpoint。"
recorded_notion_matches "$saved_notion_pid" "$saved_notion_started" "$saved_notion_exe" \
  || fail "Notion 进程身份校验失败。"
recorded_injector_matches "$injector_pid" "$injector_started" "$saved_node" "$saved_injector" "$port" \
  || fail "injector 进程身份校验失败。"

output="$($NODE "$INJECTOR" --status --port "$port" --timeout-ms 5000)"
printf '状态：已启用\n当前端口：%s\ninjector PID：%s\nNode：%s\n%s\n' \
  "$port" "$injector_pid" "$NODE_VERSION" "$output"
