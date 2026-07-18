#!/bin/bash

set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd -P)/common-macos.sh"

ensure_state_root
discover_notion_app
require_macos_runtime
load_port_config

if [ -f "$STATE_PATH" ]; then
  port="$(state_field port)" || fail "现有 state.json 不安全或已损坏。"
  injector_pid="$(state_field injectorPid)" || fail "现有 state.json 缺少 injectorPid。"
  injector_started="$(state_field injectorStartedAt)" || fail "现有 state.json 缺少 injectorStartedAt。"
  saved_node="$(state_field node)" || fail "现有 state.json 缺少 node。"
  saved_injector="$(state_field injector)" || fail "现有 state.json 缺少 injector。"
  saved_notion_pid="$(state_field notionPid)" || fail "现有 state.json 缺少 notionPid。"
  saved_notion_started="$(state_field notionStartedAt)" || fail "现有 state.json 缺少 notionStartedAt。"
  saved_notion_exe="$(state_field notionExe)" || fail "现有 state.json 缺少 notionExe。"
  if verified_cdp_endpoint "$port" \
    && recorded_notion_matches "$saved_notion_pid" "$saved_notion_started" "$saved_notion_exe" \
    && recorded_injector_matches "$injector_pid" "$injector_started" "$saved_node" "$saved_injector" "$port"; then
    "$NODE" "$INJECTOR" --once --port "$port"
    printf 'Notion Restyle 已重新应用；当前端口：%s\n' "$port"
    if [ -n "$CONFIGURED_CDP_PORT" ] && [ "$CONFIGURED_CDP_PORT" -ne "$port" ]; then
      printf '提示：.env 配置端口 %s 将在下次 Notion Restyle 会话启动时生效。\n' \
        "$CONFIGURED_CDP_PORT"
    fi
    exit 0
  fi
  if /bin/kill -0 "$injector_pid" 2>/dev/null; then
    fail "现有 state 对应一个无法验证身份的活动进程，请先运行 Status 排查。"
  fi
  /bin/rm -f "$STATE_PATH"
fi

if notion_is_running; then
  if ! /usr/bin/osascript -e 'display dialog "Notion 需要重启一次才能应用自定义样式。" buttons {"取消", "重启并应用"} default button "重启并应用" with title "Notion Restyle"' >/dev/null; then
    printf '操作已取消，Notion 未改变。\n'
    exit 0
  fi
  stop_notion
fi

select_cdp_port
port="$SELECTED_CDP_PORT"
if [ "$SELECTED_CDP_PORT_SOURCE" = configured ]; then
  printf '使用 .env 配置的 loopback 端口启动 Notion：%s\n' "$port"
else
  printf '使用随机 loopback 端口启动 Notion：%s\n' "$port"
fi
launch_notion_with_cdp "$port"
if ! wait_for_cdp "$port"; then
  stop_notion
  fail "Notion 未能打开 CDP 端口 $port；请查看 $APP_ERROR_LOG"
fi

notion_pid="$(notion_main_pids | /usr/bin/head -n 1)"
[ -n "$notion_pid" ] || fail "无法记录 Notion PID。"
notion_started="$(process_started_at "$notion_pid")"
read -r injector_pid injector_label < <(launch_injector "$port" "$notion_pid")
injector_started="$(process_started_at "$injector_pid")"
write_state "$port" "$injector_pid" "$injector_started" "$injector_label" \
  "$notion_pid" "$notion_started"

if ! "$NODE" "$INJECTOR" --once --port "$port" --timeout-ms 20000; then
  stop_recorded_injector || true
  /bin/rm -f "$STATE_PATH"
  fail "样式注入验证失败，请查看 $INJECTOR_ERROR_LOG"
fi

if [ "$SELECTED_CDP_PORT_SOURCE" = configured ]; then
  printf 'Notion Restyle 已启用；固定端口：%s\n' "$port"
else
  printf 'Notion Restyle 已启用；随机端口：%s\n' "$port"
fi
