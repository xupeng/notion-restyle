import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = path.join(root, "scripts", "common-macos.sh");
const injector = path.join(root, "scripts", "injector.mjs");

test("state is written with mode 0600 and unsafe permissions are rejected", (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "notion-restyle-state-"));
  context.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const result = spawnSync("/bin/bash", ["-c", `
    source "$1"
    NODE="$2"
    NOTION_EXE=/bin/echo
    ensure_state_root
    write_state 54321 123 "Mon Jan 1 00:00:00 2024" "com.xupeng.notion-restyle.54321" 456 "Mon Jan 1 00:00:00 2024"
    state_file_is_safe
    test "$(/usr/bin/stat -f '%Lp' "$STATE_PATH")" = 600
    /bin/chmod 644 "$STATE_PATH"
    ! state_file_is_safe
  `, "test", common, process.execPath], {
    encoding: "utf8",
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(
    path.join(temporaryHome, "Library/Application Support/NotionRestyle/state.json"),
    "utf8",
  ));
  assert.equal(state.port, 54321);
  assert.equal(state.node, process.execPath);
  assert.equal(state.injectorLabel, "com.xupeng.notion-restyle.54321");
  assert.equal(state.notionPid, 456);
  assert.equal(state.notionExe, "/bin/echo");
});

test("injector identity matching includes PID start time, paths, and exact port", async (context) => {
  const psProbe = spawnSync("/bin/ps", ["-p", String(process.pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (psProbe.status !== 0) {
    context.skip("managed sandbox does not permit process-table inspection");
    return;
  }
  const child = spawn(process.execPath, [injector, "--watch", "--port", "54322"], {
    stdio: "ignore",
  });
  context.after(() => { try { child.kill("SIGTERM"); } catch {} });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const result = spawnSync("/bin/bash", ["-c", `
    source "$1"
    NOTION_EXE=/bin/echo
    started="$(process_started_at "$2")"
    recorded_injector_matches "$2" "$started" "$3" "$4" 54322
    ! recorded_injector_matches "$2" "$started" "$3" "$4" 54323
    ! recorded_injector_matches "$2" "wrong start" "$3" "$4" 54322
  `, "test", common, String(child.pid), process.execPath, injector], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  child.kill("SIGTERM");
});

test("CDP listener resolution returns its owning Notion main process", () => {
  const result = spawnSync("/bin/bash", ["-c", `
    source "$1"
    listener_pids() { printf '300\\n301\\n'; }
    process_parent_pid() {
      case "$1" in
        300|301) printf '200\\n' ;;
        200) printf '100\\n' ;;
        100) printf '1\\n' ;;
        *) return 1 ;;
      esac
    }
    pid_is_notion_executable() { [ "$1" -eq 100 ]; }
    test "$(notion_pid_for_port 54321)" = 100
    port_belongs_to_notion 54321
  `, "test", common], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("CDP listener resolution rejects listeners owned by different Notion instances", () => {
  const result = spawnSync("/bin/bash", ["-c", `
    source "$1"
    listener_pids() { printf '300\\n301\\n'; }
    process_parent_pid() {
      case "$1" in
        300) printf '100\\n' ;;
        301) printf '101\\n' ;;
        100|101) printf '1\\n' ;;
        *) return 1 ;;
      esac
    }
    pid_is_notion_executable() { [ "$1" -eq 100 ] || [ "$1" -eq 101 ]; }
    ! notion_pid_for_port 54321
    ! port_belongs_to_notion 54321
  `, "test", common], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("launchd removal wait does not accept a lingering submitted job", () => {
  const result = spawnSync("/bin/bash", ["-c", `
    source "$1"
    checks=0
    job_is_submitted() {
      checks=$((checks + 1))
      [ "$checks" -lt 3 ]
    }
    wait_for_job_removal com.example.test
    [ "$checks" -ge 3 ]
  `, "test", common], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("watcher exits and removes its state after the recorded Notion process exits", async (context) => {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "notion-restyle-watch-exit-"));
  const stateRoot = path.join(temporaryHome, "Library/Application Support/NotionRestyle");
  const statePath = path.join(stateRoot, "state.json");
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const notionProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const child = spawn(process.execPath, [
    injector,
    "--watch",
    "--port",
    "54324",
    "--notion-pid",
    String(notionProcess.pid),
  ], {
    env: { ...process.env, HOME: temporaryHome },
    stdio: "ignore",
  });
  context.after(() => {
    try { child.kill("SIGTERM"); } catch {}
    try { notionProcess.kill("SIGKILL"); } catch {}
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ injectorPid: child.pid, port: 54324 }),
    { mode: 0o600 },
  );
  notionProcess.kill("SIGTERM");

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("watcher did not exit")), 8000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  assert.equal(exitCode, 0);
  assert.equal(fs.existsSync(statePath), false);
});
