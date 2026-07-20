#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INJECTOR="$SCRIPT_DIR/injector.mjs"
STATE_ROOT="$HOME/Library/Application Support/NotionRestyle"
STATE_PATH="$STATE_ROOT/state.json"
INJECTOR_LOG="$STATE_ROOT/injector.log"
INJECTOR_ERROR_LOG="$STATE_ROOT/injector-error.log"
APP_LOG="$STATE_ROOT/notion-launch.log"
APP_ERROR_LOG="$STATE_ROOT/notion-launch-error.log"
PORT_CONFIG_PATH="$PROJECT_ROOT/.env"
EXPECTED_NOTION_TEAM_ID="LBQJ96FQ8D"

fail() {
  printf 'Notion Restyle: %s\n' "$*" >&2
  exit 1
}

ensure_state_root() {
  /bin/mkdir -p "$STATE_ROOT"
  [ ! -L "$STATE_ROOT" ] || fail "状态目录不能是符号链接：$STATE_ROOT"
  [ "$(/usr/bin/stat -f '%Su' "$STATE_ROOT")" = "$(/usr/bin/id -un)" ] \
    || fail "状态目录不属于当前用户：$STATE_ROOT"
  /bin/chmod 700 "$STATE_ROOT"
}

discover_notion_app() {
  local candidate identifier executable_name configured="${NOTION_APP_BUNDLE:-}"
  NOTION_BUNDLE=""
  for candidate in "$configured" \
    "/Applications/Notion.app" "$HOME/Applications/Notion.app"; do
    [ -n "$candidate" ] || continue
    [ -f "$candidate/Contents/Info.plist" ] || continue
    identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$identifier" = "notion.id" ]; then NOTION_BUNDLE="$candidate"; break; fi
  done
  [ -n "$NOTION_BUNDLE" ] || fail "找不到官方 Notion 应用（notion.id）。"
  executable_name="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$NOTION_BUNDLE/Contents/Info.plist")"
  NOTION_EXE="$NOTION_BUNDLE/Contents/MacOS/$executable_name"
  [ -x "$NOTION_EXE" ] || fail "Notion 可执行文件不存在：$NOTION_EXE"
  export NOTION_BUNDLE NOTION_EXE
}

codesign_team_id() {
  /usr/bin/codesign -dv --verbose=4 "$1" 2>&1 \
    | /usr/bin/awk -F= '/^TeamIdentifier=/{print $2; exit}'
}

codesign_designated_requirement() {
  /usr/bin/codesign -d -r- "$1" 2>&1 \
    | /usr/bin/sed -n 's/^designated => //p'
}

node_candidate_is_usable() {
  local candidate="$1" version major machine_arch
  [ -n "$candidate" ] && [ -x "$candidate" ] || return 1
  version="$($candidate --version 2>/dev/null || true)"
  major="${version#v}"; major="${major%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 22 ] || return 1
  machine_arch="$(/usr/bin/uname -m)"
  /usr/bin/file "$candidate" | /usr/bin/grep -Eq "$machine_arch|universal binary" || return 1
}

discover_node_runtime() {
  local candidate configured="${NOTION_RESTYLE_NODE:-}" path_node=""
  NODE=""
  if [ -n "$configured" ]; then
    node_candidate_is_usable "$configured" \
      || fail "NOTION_RESTYLE_NODE 不是可用的 Node.js 22+ runtime：$configured"
    NODE="$(canonical_existing_path "$configured")"
  else
    path_node="$(command -v node 2>/dev/null || true)"
    for candidate in "$path_node" /opt/homebrew/bin/node /usr/local/bin/node \
      "$HOME"/.nvm/versions/node/*/bin/node; do
      node_candidate_is_usable "$candidate" || continue
      NODE="$(canonical_existing_path "$candidate")"
      break
    done
  fi
  [ -n "$NODE" ] || fail "找不到 Node.js 22 或更高版本；可用 NOTION_RESTYLE_NODE 指定。"
  NODE_VERSION="$($NODE --version)"
  export NODE NODE_VERSION
}

require_macos_runtime() {
  local app_team app_requirement signature_details
  [ "$(/usr/bin/uname -s)" = "Darwin" ] || fail "仅支持 macOS。"
  app_team="$(codesign_team_id "$NOTION_BUNDLE")"
  [ "$app_team" = "$EXPECTED_NOTION_TEAM_ID" ] || fail "Notion 应用签名 Team ID 不符合预期。"
  app_requirement="$(codesign_designated_requirement "$NOTION_BUNDLE")"
  case "$app_requirement" in
    *'identifier "notion.id"'*'anchor apple generic'*"certificate leaf[subject.OU] = $EXPECTED_NOTION_TEAM_ID"*) ;;
    *) fail "Notion 应用指定要求不符合官方签名预期。" ;;
  esac
  signature_details="$(/usr/bin/codesign -dv --verbose=4 "$NOTION_BUNDLE" 2>&1)"
  printf '%s\n' "$signature_details" | /usr/bin/grep -q '^Notarization Ticket=stapled$' \
    || fail "Notion 应用缺少 notarization ticket。"
  discover_node_runtime
}

canonical_existing_path() {
  local input="$1" directory basename
  [ -e "$input" ] || return 1
  directory="$(cd "$(dirname "$input")" 2>/dev/null && pwd -P)" || return 1
  basename="$(basename "$input")"
  printf '%s/%s\n' "$directory" "$basename"
}

process_executable_path() {
  /usr/sbin/lsof -a -p "$1" -d txt -Fn 2>/dev/null \
    | /usr/bin/awk '/^n/{sub(/^n/, ""); print; exit}'
}

pid_is_notion_executable() {
  local actual expected
  actual="$(canonical_existing_path "$(process_executable_path "$1")" 2>/dev/null || true)"
  expected="$(canonical_existing_path "$NOTION_EXE" 2>/dev/null || true)"
  [ -n "$actual" ] && [ "$actual" = "$expected" ]
}

process_parent_pid() {
  /bin/ps -p "$1" -o ppid= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

notion_main_pids() {
  local pid command_line
  while read -r pid command_line; do
    [ -n "$pid" ] || continue
    case "$command_line" in "$NOTION_EXE"*) pid_is_notion_executable "$pid" && printf '%s\n' "$pid" ;; esac
  done < <(/bin/ps -axo pid=,command=)
}

notion_is_running() { [ -n "$(notion_main_pids)" ]; }

process_started_at() {
  /bin/ps -p "$1" -o lstart= 2>/dev/null | /usr/bin/awk '{$1=$1; print}'
}

listener_pids() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/sort -u || true
}

port_is_available() { [ -z "$(listener_pids "$1")" ]; }

load_port_config() {
  local line value normalized declarations=0
  CONFIGURED_CDP_PORT=""
  [ -e "$PORT_CONFIG_PATH" ] || return 0
  [ -f "$PORT_CONFIG_PATH" ] && [ ! -L "$PORT_CONFIG_PATH" ] \
    || fail "端口配置必须是普通文件且不能是符号链接：$PORT_CONFIG_PATH"

  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*($|#) ]]; then continue; fi
    if [[ "$line" =~ ^[[:space:]]*NOTION_RESTYLE_PORT([[:space:]]|=|$) ]]; then
      declarations=$((declarations + 1))
      [ "$declarations" -eq 1 ] || fail ".env 中 NOTION_RESTYLE_PORT 不能重复配置。"
      if [[ "$line" =~ ^[[:space:]]*NOTION_RESTYLE_PORT[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
        value="${BASH_REMATCH[1]}"
      else
        fail ".env 中 NOTION_RESTYLE_PORT 必须是 1024–65535 的整数。"
      fi
      normalized="$value"
      while [ "${normalized#0}" != "$normalized" ]; do normalized="${normalized#0}"; done
      [ -n "$normalized" ] || normalized=0
      [ "${#normalized}" -le 5 ] \
        || fail ".env 中 NOTION_RESTYLE_PORT 必须是 1024–65535 的整数。"
      value=$((10#$normalized))
      [ "$value" -ge 1024 ] && [ "$value" -le 65535 ] \
        || fail ".env 中 NOTION_RESTYLE_PORT 必须是 1024–65535 的整数。"
      CONFIGURED_CDP_PORT="$value"
    fi
  done < "$PORT_CONFIG_PATH"
}

select_cdp_port() {
  if [ -n "$CONFIGURED_CDP_PORT" ]; then
    port_is_available "$CONFIGURED_CDP_PORT" \
      || fail ".env 配置的端口 $CONFIGURED_CDP_PORT 已被占用。"
    SELECTED_CDP_PORT="$CONFIGURED_CDP_PORT"
    SELECTED_CDP_PORT_SOURCE=configured
    return 0
  fi
  SELECTED_CDP_PORT="$(generate_random_port)" || fail "无法生成可用的随机高位端口。"
  SELECTED_CDP_PORT_SOURCE=random
}

pid_is_notion_descendant() {
  notion_main_pid_for_process "$1" >/dev/null
}

notion_main_pid_for_process() {
  local current="$1" parent depth=0
  while [ "$current" -gt 1 ] 2>/dev/null && [ "$depth" -lt 32 ]; do
    if pid_is_notion_executable "$current"; then
      printf '%s\n' "$current"
      return 0
    fi
    parent="$(process_parent_pid "$current")"
    case "$parent" in ''|*[!0-9]*) return 1 ;; esac
    [ "$parent" -ne "$current" ] || return 1
    current="$parent"; depth=$((depth + 1))
  done
  return 1
}

notion_pid_for_port() {
  local port="$1" pid candidate resolved="" found=false
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    found=true
    candidate="$(notion_main_pid_for_process "$pid")" || return 1
    if [ -n "$resolved" ] && [ "$candidate" -ne "$resolved" ]; then return 1; fi
    resolved="$candidate"
  done < <(listener_pids "$port")
  [ "$found" = true ] && printf '%s\n' "$resolved"
}

port_belongs_to_notion() { notion_pid_for_port "$1" >/dev/null; }

verified_cdp_endpoint() {
  local port="$1"
  port_belongs_to_notion "$port" || return 1
  /usr/bin/curl --noproxy '*' --silent --fail --max-time 1 \
    "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

generate_random_port() {
  local attempt raw port
  for attempt in $(/usr/bin/jot 32 1); do
    raw="$(/usr/bin/od -An -N2 -tu2 /dev/urandom | /usr/bin/awk '{$1=$1; print}')"
    case "$raw" in ''|*[!0-9]*) continue ;; esac
    port=$((49152 + raw % 16384))
    if port_is_available "$port"; then printf '%s\n' "$port"; return 0; fi
  done
  return 1
}

wait_for_cdp() {
  local port="$1" deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    verified_cdp_endpoint "$port" && return 0
    /bin/sleep 0.25
  done
  return 1
}

stop_notion() {
  local pid deadline
  notion_is_running || return 0
  /usr/bin/osascript -e 'tell application id "notion.id" to quit' >/dev/null 2>&1 || true
  deadline=$((SECONDS + 15))
  while notion_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  if notion_is_running; then
    while IFS= read -r pid; do [ -n "$pid" ] && /bin/kill -TERM "$pid" 2>/dev/null || true; done < <(notion_main_pids)
  fi
  deadline=$((SECONDS + 5))
  while notion_is_running && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.25; done
  notion_is_running && fail "无法安全停止 Notion。"
  return 0
}

launch_notion_with_cdp() {
  local port="$1"
  : > "$APP_LOG"; : > "$APP_ERROR_LOG"
  /usr/bin/open -na "$NOTION_BUNDLE" --args \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port="$port" \
    >>"$APP_LOG" 2>>"$APP_ERROR_LOG"
}

launch_notion_normally() { /usr/bin/open -na "$NOTION_BUNDLE"; }

state_file_is_safe() {
  [ -f "$STATE_PATH" ] && [ ! -L "$STATE_PATH" ] || return 1
  [ "$(/usr/bin/stat -f '%Lp' "$STATE_PATH" 2>/dev/null || true)" = "600" ] \
    && [ "$(/usr/bin/stat -f '%Su' "$STATE_PATH" 2>/dev/null || true)" = "$(/usr/bin/id -un)" ]
}

state_field() {
  local key="$1"
  state_file_is_safe || return 1
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = data[key];
    if (typeof value !== "string" && typeof value !== "number") process.exit(2);
    process.stdout.write(String(value));
  ' "$STATE_PATH" "$key"
}

write_state() {
  local port="$1" injector_pid="$2" injector_started_at="$3" injector_label="$4"
  local notion_pid="$5" notion_started_at="$6"
  local temporary="$STATE_PATH.$$.tmp"
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, port, injectorPid, injectorStartedAt, injectorLabel, notionPid, notionStartedAt, node, injector, exe] = process.argv.slice(1);
    const state = { schemaVersion: 2, port: Number(port), injectorPid: Number(injectorPid), injectorStartedAt,
      injectorLabel, notionPid: Number(notionPid), notionStartedAt, node, injector, notionExe: exe,
      createdAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  ' "$temporary" "$port" "$injector_pid" "$injector_started_at" "$injector_label" \
    "$notion_pid" "$notion_started_at" "$NODE" "$INJECTOR" "$NOTION_EXE"
  /bin/chmod 600 "$temporary"
  /bin/mv "$temporary" "$STATE_PATH"
}

recorded_injector_matches() {
  local pid="$1" expected_start="$2" expected_node="$3" expected_injector="$4" expected_port="$5"
  local command_line actual_start
  /bin/kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(/bin/ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$command_line" in "$expected_node $expected_injector --watch --port $expected_port"*) ;; *) return 1 ;; esac
  actual_start="$(process_started_at "$pid")"
  [ -n "$actual_start" ] && [ "$actual_start" = "$expected_start" ]
}

recorded_notion_matches() {
  local pid="$1" expected_start="$2" expected_exe="$3" actual_start canonical_saved canonical_current
  canonical_saved="$(canonical_existing_path "$expected_exe" 2>/dev/null || true)"
  canonical_current="$(canonical_existing_path "$NOTION_EXE" 2>/dev/null || true)"
  [ -n "$canonical_saved" ] && [ "$canonical_saved" = "$canonical_current" ] || return 1
  pid_is_notion_executable "$pid" || return 1
  actual_start="$(process_started_at "$pid")"
  [ -n "$actual_start" ] && [ "$actual_start" = "$expected_start" ]
}

injector_label_for_port() {
  printf 'com.xupeng.notion-restyle.%s\n' "$1"
}

submitted_job_pid() {
  local label="$1"
  /bin/launchctl print "gui/$(/usr/bin/id -u)/$label" 2>/dev/null \
    | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+$/{print $3; exit}' \
    || true
}

job_is_submitted() {
  /bin/launchctl print "gui/$(/usr/bin/id -u)/$1" >/dev/null 2>&1
}

wait_for_job_removal() {
  local label="$1" deadline=$((SECONDS + 5))
  while job_is_submitted "$label" && [ "$SECONDS" -lt "$deadline" ]; do
    /bin/sleep 0.1
  done
  ! job_is_submitted "$label"
}

stop_recorded_injector() {
  local pid started node injector label expected_label port deadline
  [ -f "$STATE_PATH" ] || return 0
  pid="$(state_field injectorPid)" || fail "state.json 中缺少 injectorPid。"
  started="$(state_field injectorStartedAt)" || fail "state.json 中缺少 injectorStartedAt。"
  node="$(state_field node)" || fail "state.json 中缺少 node。"
  injector="$(state_field injector)" || fail "state.json 中缺少 injector。"
  label="$(state_field injectorLabel)" || fail "state.json 中缺少 injectorLabel。"
  port="$(state_field port)" || fail "state.json 中缺少 port。"
  expected_label="$(injector_label_for_port "$port")"
  [ "$label" = "$expected_label" ] || fail "记录的 injector launchd label 不符合预期。"
  if ! /bin/kill -0 "$pid" 2>/dev/null; then
    /bin/launchctl remove "$label" >/dev/null 2>&1 || true
    wait_for_job_removal "$label" || fail "injector launchd job 未能按时移除。"
    return 0
  fi
  recorded_injector_matches "$pid" "$started" "$node" "$injector" "$port" \
    || fail "记录的 injector 进程身份不匹配，拒绝结束该进程。"
  /bin/launchctl remove "$label" >/dev/null 2>&1 || /bin/kill -TERM "$pid"
  deadline=$((SECONDS + 6))
  while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  if /bin/kill -0 "$pid" 2>/dev/null; then
    recorded_injector_matches "$pid" "$started" "$node" "$injector" "$port" \
      || fail "injector 未按时退出且进程身份已变化，拒绝强制结束。"
    /bin/kill -KILL "$pid"
    deadline=$((SECONDS + 3))
    while /bin/kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.2; done
  fi
  /bin/kill -0 "$pid" 2>/dev/null && fail "injector 未能按时退出。"
  wait_for_job_removal "$label" || fail "injector launchd job 未能按时移除。"
  return 0
}

launch_injector() {
  local port="$1" notion_pid="$2" label pid deadline attempt
  : > "$INJECTOR_LOG"; : > "$INJECTOR_ERROR_LOG"
  label="$(injector_label_for_port "$port")"
  for attempt in 1 2 3; do
    /bin/launchctl remove "$label" >/dev/null 2>&1 || true
    if wait_for_job_removal "$label"; then
      # launchd can briefly reject reuse after `print` stops showing a removed submitted job.
      /bin/sleep 0.2
      if /bin/launchctl submit -l "$label" -o "$INJECTOR_LOG" -e "$INJECTOR_ERROR_LOG" -- \
        "$NODE" "$INJECTOR" --watch --port "$port" --notion-pid "$notion_pid"; then
        deadline=$((SECONDS + 5))
        while [ "$SECONDS" -lt "$deadline" ]; do
          pid="$(submitted_job_pid "$label")"
          if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
            printf '%s %s\n' "$pid" "$label"
            return 0
          fi
          /bin/sleep 0.1
        done
      fi
    fi
    /bin/launchctl remove "$label" >/dev/null 2>&1 || true
    wait_for_job_removal "$label" || true
  done
  fail "injector 启动失败，请查看 $INJECTOR_ERROR_LOG"
}
