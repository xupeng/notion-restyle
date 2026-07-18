import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  earlyPayloadFor,
  isNotionPageUrl,
  isValidCdpPageTarget,
  notionTargetKind,
  parseArgs,
  processIsAlive,
  recordNeedsVerification,
  removeOwnedState,
  stateBelongsToWatcher,
} from "../scripts/injector.mjs";

const port = 54321;
const validTarget = {
  id: "PAGE_ABC123",
  type: "page",
  url: "https://app.notion.com/blank?tabCount=0",
  webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/PAGE_ABC123`,
};

test("accepts current Notion pages and rejects non-Notion URLs", () => {
  assert.equal(isNotionPageUrl("https://app.notion.com/"), true);
  assert.equal(isNotionPageUrl("https://app.notion.com/blank?tabCount=0"), true);
  assert.equal(isNotionPageUrl(""), false);
  assert.equal(isNotionPageUrl("file:///Applications/Notion.app/tabs/index.html"), false);
  assert.equal(isNotionPageUrl("https://www.notion.so/page"), false);
  assert.equal(isNotionPageUrl("https://app.notion.com.example.com/"), false);
  assert.equal(isValidCdpPageTarget(validTarget, port), true);
  assert.equal(notionTargetKind("https://app.notion.com/blank?tabCount=0"), "blank");
  assert.equal(notionTargetKind("https://app.notion.com/p/workspace/page-id"), "page");
  assert.equal(notionTargetKind("file:///tmp/index.html"), "unknown");
});

test("rejects mismatched and unsafe CDP WebSocket targets", () => {
  const rejected = [
    { ...validTarget, type: "service_worker" },
    { ...validTarget, id: "wrong-id" },
    { ...validTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${port + 1}/devtools/page/PAGE_ABC123` },
    { ...validTarget, webSocketDebuggerUrl: `ws://example.com:${port}/devtools/page/PAGE_ABC123` },
    { ...validTarget, webSocketDebuggerUrl: `ws://user@127.0.0.1:${port}/devtools/page/PAGE_ABC123` },
    { ...validTarget, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/PAGE_ABC123?token=x` },
  ];
  for (const target of rejected) assert.equal(isValidCdpPageTarget(target, port), false);
});

test("parses modes, dynamic ports, timeouts, and watcher PID", () => {
  assert.deepEqual(parseArgs(["--status", "--port", String(port)]), {
    mode: "status",
    port,
    timeoutMs: 15000,
    notionPid: null,
  });
  assert.deepEqual(parseArgs([
    "--watch", "--port", String(port), "--notion-pid", "123", "--timeout-ms", "5000",
  ]), {
    mode: "watch",
    port,
    timeoutMs: 5000,
    notionPid: 123,
  });
  assert.throws(() => parseArgs(["--status", "--port", "80"]), /valid --port/);
  assert.throws(() => parseArgs(["--port", String(port)]), /Choose/);
  assert.throws(
    () => parseArgs(["--status", "--once", "--port", String(port)]),
    /exactly one mode/,
  );
  assert.throws(
    () => parseArgs(["--status", "--port", String(port), "--notion-pid", "123"]),
    /only valid with --watch/,
  );
  assert.equal(processIsAlive(process.pid), true);
  assert.equal(processIsAlive(-1), false);
});

test("early payload is restricted to the current Notion host", () => {
  const payload = earlyPayloadFor("window.__installed = true", "revision-1");
  assert.match(payload, /location\.protocol === "https:"/);
  assert.match(payload, /location\.hostname === "app\.notion\.com"/);
  assert.match(payload, /revision-1/);
});

test("periodically verifies existing renderer sessions", () => {
  assert.equal(recordNeedsVerification({ lastVerifiedAt: 1000 }, 1999), false);
  assert.equal(recordNeedsVerification({ lastVerifiedAt: 1000 }, 2000), true);
  assert.equal(recordNeedsVerification({ lastVerifiedAt: Number.NaN }, 2000), true);
});

test("removes runtime state only when it belongs to the exiting watcher", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "notion-restyle-watcher-"));
  const statePath = path.join(temporary, "state.json");
  const pid = 43210;
  try {
    assert.equal(stateBelongsToWatcher({ injectorPid: pid, port }, pid, port), true);
    assert.equal(stateBelongsToWatcher({ injectorPid: pid + 1, port }, pid, port), false);

    await fs.writeFile(statePath, JSON.stringify({ injectorPid: pid + 1, port }), { mode: 0o600 });
    assert.equal(await removeOwnedState(statePath, pid, port), false);
    await fs.access(statePath);

    await fs.writeFile(statePath, JSON.stringify({ injectorPid: pid, port }), { mode: 0o600 });
    assert.equal(await removeOwnedState(statePath, pid, port), true);
    await assert.rejects(fs.access(statePath), { code: "ENOENT" });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
