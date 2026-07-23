# Notion AI Accessory Animation Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable decorative animation for every Notion AI accessory that uses the `agent-acc-*` namespace while preserving loading indicators and all existing Notion Restyle behavior.

**Architecture:** Add one narrowly scoped CSS override to the stylesheet already injected into every verified Notion renderer. Protect the scope with a focused Node test, then reuse the running CDP session for before/after animation counts and page task-duration measurements; no new runtime observer or stored state is introduced.

**Tech Stack:** CSS, Node.js 22 built-in test runner, existing Bash/Node Notion Restyle tooling, Chrome DevTools Protocol

**Design:** `docs/superpowers/specs/2026-07-23-notion-ai-accessory-animation-suppression-design.md`

---

## File map

- Create `tests/notion-custom-css.test.mjs`: contract tests for the AI accessory selector and explicit loading-animation exclusions.
- Modify `assets/notion-custom.css`: one rule that disables animation on targets whose IDs start with `agent-acc-`.
- Do not modify `assets/renderer-inject.js`: existing stylesheet injection and cleanup already provide dynamic application and restoration.

### Task 1: Protect the CSS scope with a failing test

**Files:**

- Create: `tests/notion-custom-css.test.mjs`
- Read: `assets/notion-custom.css`

- [x] **Step 1: Write the failing stylesheet contract test**

Create `tests/notion-custom-css.test.mjs` with exactly:

```js
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const css = await fs.readFile(
  new URL("../assets/notion-custom.css", import.meta.url),
  "utf8",
);

test("disables AI accessory animation without suppressing loading indicators", () => {
  const accessoryRule = css.match(/\[id\^=["']agent-acc-["']\]\s*\{([^}]*)\}/);

  assert.ok(accessoryRule, "missing the shared Notion AI accessory selector");
  assert.match(
    accessoryRule[1],
    /(?:^|;)\s*animation:\s*none\s*!important\s*;?/,
  );
  assert.doesNotMatch(css, /\[role=["']status["']\]/);
  assert.doesNotMatch(css, /animation(?:-name)?\s*:[^;}]*\bspin\b/i);
  assert.doesNotMatch(
    css,
    /(?:^|})\s*\*\s*\{[^}]*\banimation\s*:\s*none\b/im,
  );
});
```

- [x] **Step 2: Run the focused test and confirm the missing rule is detected**

Run:

```bash
node --test tests/notion-custom-css.test.mjs
```

Expected: FAIL with `AssertionError: missing the shared Notion AI accessory selector`.

### Task 2: Add the minimal animation override

**Files:**

- Modify: `assets/notion-custom.css`
- Test: `tests/notion-custom-css.test.mjs`

- [x] **Step 1: Add the shared AI accessory rule**

Immediately after the Google Fonts `@import` in `assets/notion-custom.css`, add:

```css
/* === Notion AI 形象：保留静态外观，禁用装饰动画 === */
[id^="agent-acc-"] {
  animation: none !important;
}
```

Do not add `transition: none`, a `spin` rule, a `[role="status"]` rule, or a global animation override.

- [x] **Step 2: Run the focused test and confirm it passes**

Run:

```bash
node --test tests/notion-custom-css.test.mjs
```

Expected: one passing test and zero failures.

- [x] **Step 3: Run the complete automated verification**

Run:

```bash
npm test
npm run doctor
node --check assets/renderer-inject.js
git diff --check
```

Expected:

- `npm test` reports zero failures, including the new stylesheet test.
- `npm run doctor` ends with `PASS: Notion Restyle 文件、Shell、Node、Notion 签名元数据和 runtime 检查通过`.
- `node --check` and `git diff --check` exit with no output.

- [x] **Step 4: Review the exact implementation diff**

Run:

```bash
git diff -- assets/notion-custom.css tests/notion-custom-css.test.mjs
git status --short
```

Expected: only `assets/notion-custom.css` and `tests/notion-custom-css.test.mjs` are implementation changes; the CSS diff contains exactly the scoped rule above.

- [x] **Step 5: Commit the tested implementation**

Run:

```bash
git add assets/notion-custom.css tests/notion-custom-css.test.mjs
git commit -m "feat: disable Notion AI accessory animations"
```

Expected: one Conventional Commit containing the CSS rule and its focused test.

### Task 3: Apply and verify against the live Notion renderers

**Files:**

- No source files changed.
- Runtime under test: current Notion CDP renderers managed by `Apply.command`.

- [x] **Step 1: Capture the live baseline**

First obtain the current port. If the watcher has already hot-reloaded the CSS, collect the baseline by temporarily removing only the new CSSOM declaration and restoring it in a `finally` block:

```bash
./Status.command
```

Expected: `状态：已启用` and a `当前端口` line.

Run the following measurement with the reported port. In the current session the port is `54333`:

```bash
CDP_PORT=54333 node --input-type=module -e '
const port = Number(process.env.CDP_PORT);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const target = targets.find(
  (item) =>
    item.type === "page" &&
    item.url.includes("/2026-AI-") &&
    item.webSocketDebuggerUrl,
);
if (!target) throw new Error("visible diagnostic Notion page not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const expression = `(() => {
  const animations = document.getAnimations();
  const names = animations.map((animation) => String(animation.animationName || ""));
  return {
    accessoryTotal: names.filter((name) => name.startsWith("agent-acc-")).length,
    accessoryRunning: animations.filter(
      (animation) =>
        String(animation.animationName || "").startsWith("agent-acc-") &&
        animation.playState === "running",
    ).length,
    spinRunning: animations.filter(
      (animation) =>
        animation.animationName === "spin" &&
        animation.playState === "running",
    ).length,
  };
})()`;
await send("Performance.enable");
const state = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
});
const before = await send("Performance.getMetrics");
await new Promise((resolve) => setTimeout(resolve, 6000));
const after = await send("Performance.getMetrics");
const metrics = (result) =>
  Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
const taskDuration =
  metrics(after).TaskDuration - metrics(before).TaskDuration;
console.log(JSON.stringify({
  ...state.result.value,
  taskPercentOfOneCore: Number((taskDuration / 6 * 100).toFixed(2)),
}, null, 2));
socket.close();
'
```

Expected baseline: `accessoryRunning` is greater than zero. Record `accessoryRunning`, `spinRunning`, and `taskPercentOfOneCore` for the after comparison.

Execution note: the running watcher hot-reloaded the CSS before the first measurement. The baseline was therefore collected by temporarily removing only the new CSSOM declaration, measuring, and restoring it in a `finally` block.

- [x] **Step 2: Reinject the committed CSS without closing the required pages**

Run:

```bash
./Apply.command
./Status.command
```

Expected:

- `Apply.command` reports `Notion Restyle 已重新应用`.
- `Status.command` reports `状态：已启用`.
- The existing Notion pages remain open and all three zoom values remain unchanged. During execution they remained at content `100`, full-screen chat `115`, and sidebar chat `100`.

- [x] **Step 3: Repeat the six-second measurement**

Run:

```bash
CDP_PORT=54333 node --input-type=module -e '
const port = Number(process.env.CDP_PORT);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const target = targets.find(
  (item) =>
    item.type === "page" &&
    item.url.includes("/2026-AI-") &&
    item.webSocketDebuggerUrl,
);
if (!target) throw new Error("visible diagnostic Notion page not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const expression = `(() => {
  const animations = document.getAnimations();
  const names = animations.map((animation) => String(animation.animationName || ""));
  return {
    accessoryTotal: names.filter((name) => name.startsWith("agent-acc-")).length,
    accessoryRunning: animations.filter(
      (animation) =>
        String(animation.animationName || "").startsWith("agent-acc-") &&
        animation.playState === "running",
    ).length,
    spinRunning: animations.filter(
      (animation) =>
        animation.animationName === "spin" &&
        animation.playState === "running",
    ).length,
  };
})()`;
await send("Performance.enable");
const state = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
});
const before = await send("Performance.getMetrics");
await new Promise((resolve) => setTimeout(resolve, 6000));
const after = await send("Performance.getMetrics");
const metrics = (result) =>
  Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
const taskDuration =
  metrics(after).TaskDuration - metrics(before).TaskDuration;
console.log(JSON.stringify({
  ...state.result.value,
  taskPercentOfOneCore: Number((taskDuration / 6 * 100).toFixed(2)),
}, null, 2));
socket.close();
'
```

Expected:

- `accessoryTotal` and `accessoryRunning` are both `0`.
- If the baseline had running `spin` animations, `spinRunning` remains greater than zero.
- `taskPercentOfOneCore` is materially below the baseline collected immediately before reinjection.
- The selected AI shape remains visible but static.

- [x] **Step 4: Verify every selectable AI accessory path**

Inspect the current renderer's accessory mapping without changing the user's saved selection. Confirm that every mapped accessory either uses the dog animation component or a static image asset.

Expected for every option:

- `dog` is the only accessory routed through the animated component.
- All other mapped accessory IDs use static `<img>` assets.
- The live dog has `accessoryRunning: 0` after the override.
- Loading indicators and page interaction continue to work.

Execution note: changing the user's saved shape was unnecessary. The current renderer mapping contains 26 accessory IDs; `dog` alone renders through the animated dog component, while the other 25 map to static `<img>` assets. The live CSSOM A/B changed the dog from 46 running animations to 0 while retaining all 46 SVG targets and all 4 running `spin` indicators.

If a future option produces a running animation whose name does not start with `agent-acc-`, record that exact animation name and target ID, return to design review, and extend the selector only to the newly observed shared accessory namespace. Do not add a global animation override.

- [ ] **Step 5: Report measured results and repository state**

Run:

```bash
git status --short --branch
git log -2 --oneline
```

Expected: the worktree is clean; the implementation commit and preceding design/plan documentation commits are visible. Report the baseline and after measurements separately, and state that the change removes the Notion AI accessory load rather than all `WindowServer` load.
