import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { buildRendererPayload, readRendererPayload } from "../scripts/renderer-payload.mjs";
import {
  buildUserscript,
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_UPDATE_URL,
  NOTION_BROWSER_HOSTS,
  parseArgs,
  renderUserscript,
} from "../scripts/build-userscript.mjs";

test("shared payload preserves CSS literally, including replacement strings and placeholder text", () => {
  const css = "/* $& $` $' $$ __NOTION_RESTYLE_VERSION_JSON__ */\nbody::after { content: '\"\\\\'; }";
  const template = "({ css: __NOTION_RESTYLE_CSS_JSON__, version: __NOTION_RESTYLE_VERSION_JSON__ })";
  const first = buildRendererPayload(css, template);
  const actual = vm.runInNewContext(first.payload);
  assert.equal(actual.css, css);
  assert.equal(actual.version, first.revision);
  assert.match(first.revision, /^[a-f0-9]{20}$/);
  assert.deepEqual(buildRendererPayload(css, template), first);
  assert.notEqual(buildRendererPayload(`${css}\n`, template).revision, first.revision);
  assert.notEqual(buildRendererPayload(css, `${template}\n`).revision, first.revision);
  assert.throws(() => buildRendererPayload(css, ""), /exactly one/);
  assert.throws(() => buildRendererPayload(css, `${template}\n${template}`), /exactly one/);
});

test("userscript embeds the shared payload and scopes metadata to exact Notion hosts", async () => {
  const built = await readRendererPayload();
  const script = renderUserscript({ ...built, version: "0.1.0" });
  assert.ok(script.startsWith("// ==UserScript==\n"));
  assert.ok(script.includes(built.payload));
  assert.deepEqual(
    [...script.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map((match) => match[1]),
    NOTION_BROWSER_HOSTS.map((host) => `https://${host}/*`),
  );
  assert.match(script, /@run-at\s+document-end/);
  assert.match(script, /@inject-into\s+content/);
  assert.match(script, /@noframes/);
  assert.deepEqual(
    [...script.matchAll(/^\/\/ @grant\s+(\S+)$/gm)].map((match) => match[1]),
    ["GM_registerMenuCommand"],
  );
  assert.doesNotMatch(script, /^\/\/ @(?:require|resource|connect)\b/m);
  assert.ok(script.includes(`// @updateURL    ${DEFAULT_UPDATE_URL}\n`));
  assert.ok(script.includes(`// @downloadURL  ${DEFAULT_UPDATE_URL}\n`));
  assert.doesNotMatch(script, /__NOTION_RESTYLE_(?:CSS|VERSION)_JSON__/);
  assert.doesNotMatch(script, /\b(?:eval|fetch)\(/);
});

test("runtime host and frame guards reject pages even if metadata matching is bypassed", () => {
  const script = renderUserscript({
    payload: "window.installed = true",
    version: "0.1.0",
  });
  for (const host of NOTION_BROWSER_HOSTS) {
    const window = {};
    window.top = window.self = window;
    let menus = 0;
    const context = {
      window,
      location: { protocol: "https:", hostname: host, port: "" },
      GM_registerMenuCommand() { menus += 1; },
    };
    vm.runInNewContext(script, context);
    vm.runInNewContext(script, context);
    assert.equal(window.installed, true);
    assert.equal(menus, 1, "reinjection must not duplicate the menu command");
  }
  for (const location of [
    { protocol: "http:", hostname: "app.notion.com", port: "" },
    { protocol: "https:", hostname: "app.notion.com.example.com", port: "" },
    { protocol: "https:", hostname: "www.notion.com", port: "" },
    { protocol: "https:", hostname: "example.notion.site", port: "" },
    { protocol: "https:", hostname: "app.notion.com", port: "8443" },
  ]) {
    const window = {};
    window.top = window.self = window;
    vm.runInNewContext(script, { window, location });
    assert.equal(window.installed, undefined);
  }
  const frame = { self: {}, top: {} };
  vm.runInNewContext(script, { window: frame });
  assert.equal(frame.installed, undefined);
});

test("published builds validate metadata and specify both update URLs", () => {
  const options = { payload: "void 0", version: "0.2.1" };
  const url = "https://example.com/notion-restyle.user.js";
  const script = renderUserscript({ ...options, updateUrl: url });
  assert.ok(script.includes(`// @updateURL    ${url}\n`));
  assert.ok(script.includes(`// @downloadURL  ${url}\n`));
  for (const version of ["", "0.1", "latest", "0.1.0\n// @match *://*/*"]) {
    assert.throws(() => renderUserscript({ ...options, version }), /version/);
  }
  for (const updateUrl of [
    "", "not a URL", "http://example.com/style.user.js",
    "https://user:password@example.com/style.user.js",
    "https://example.com/style.user.js#fragment",
    "https://example.com/style.user.js\n// @grant unsafeWindow",
  ]) {
    assert.throws(() => renderUserscript({ ...options, updateUrl }), /Update URL/);
  }
  assert.throws(() => renderUserscript({ ...options, payload: "(() => {" }), SyntaxError);
});

test("build arguments reject missing, duplicate, and unknown flags", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(["--check"]), { check: true });
  assert.deepEqual(parseArgs(["--check", "--version", "0.2.0"]), { check: true, version: "0.2.0" });
  assert.deepEqual(parseArgs(["--version", "0.2.0", "--update-url", "https://example.com/style.user.js"]), {
    version: "0.2.0", updateUrl: "https://example.com/style.user.js",
  });
  assert.throws(() => parseArgs(["--version"]), /Missing value/);
  assert.throws(() => parseArgs(["--version", "--update-url"]), /Missing value/);
  assert.throws(() => parseArgs(["--version", "0.1.0", "--version", "0.2.0"]), /Duplicate/);
  assert.throws(() => parseArgs(["--check", "--check"]), /Duplicate/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown/);
});

test("CLI reports invalid arguments concisely and exits with a failure status", () => {
  const entry = fileURLToPath(new URL("../scripts/build-userscript.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [entry, "--unknown"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "notion-restyle: Unknown argument: --unknown\n");
});

test("build writes a deterministic standalone installable artifact with the package version", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "notion-restyle-userscript-"));
  try {
    const manifest = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
    const first = await buildUserscript({ outputDirectory: temporary });
    assert.equal(first.version, manifest.version);
    assert.equal(first.outputPath, path.join(temporary, "notion-restyle.user.js"));
    const script = await fs.readFile(first.outputPath, "utf8");
    assert.ok(script.includes(`// @updateURL    ${DEFAULT_UPDATE_URL}\n`));
    assert.ok(script.includes(`// @downloadURL  ${DEFAULT_UPDATE_URL}\n`));
    const second = await buildUserscript({ outputDirectory: temporary });
    assert.deepEqual(second, first);
    assert.equal(await fs.readFile(second.outputPath, "utf8"), script);
    const published = await buildUserscript({
      outputDirectory: temporary,
      version: "0.2.0",
      updateUrl: "https://example.com/notion-restyle.user.js",
    });
    assert.equal(published.version, "0.2.0");
    assert.match(await fs.readFile(published.outputPath, "utf8"), /@version\s+0\.2\.0/);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("check mode detects missing and stale artifacts without writing files", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "notion-restyle-userscript-check-"));
  const outputDirectory = path.join(temporary, "userscripts");
  try {
    await assert.rejects(buildUserscript({ outputDirectory, check: true }), /Missing userscript.*build:userscript/);
    await assert.rejects(fs.access(outputDirectory), { code: "ENOENT" });
    const built = await buildUserscript({ outputDirectory });
    const original = await fs.readFile(built.outputPath, "utf8");
    const checked = await buildUserscript({ outputDirectory, check: true });
    assert.deepEqual(checked, { ...built, checked: true });
    await assert.rejects(buildUserscript({ outputDirectory, check: true, version: "9.0.0" }), /Outdated userscript/);
    await assert.rejects(buildUserscript({
      outputDirectory, check: true, updateUrl: "https://example.com/notion-restyle.user.js",
    }), /Outdated userscript/);
    assert.equal(await fs.readFile(built.outputPath, "utf8"), original);
    await fs.writeFile(built.outputPath, `${original}\n// stale\n`, "utf8");
    await assert.rejects(buildUserscript({ outputDirectory, check: true }), /Outdated userscript.*build:userscript/);
    assert.equal(await fs.readFile(built.outputPath, "utf8"), `${original}\n// stale\n`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("repository install link and version-controlled artifact match the default build", async () => {
  assert.equal(DEFAULT_OUTPUT_DIRECTORY, fileURLToPath(new URL("../userscripts", import.meta.url)));
  assert.equal(DEFAULT_UPDATE_URL, "https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js");
  const checked = await buildUserscript({ check: true });
  assert.equal(checked.checked, true);
  const readme = await fs.readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`](${DEFAULT_UPDATE_URL})`));
});

test("PR preflight builds before testing while standalone tests keep a read-only artifact check", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts["prepare:pr"], "npm run build:userscript && npm test");
  assert.equal(manifest.scripts.pretest, "npm run check:userscript");
  assert.equal(manifest.scripts["check:userscript"], "node scripts/build-userscript.mjs --check");
  const instructions = await fs.readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.ok(instructions.includes("npm run prepare:pr"));
  assert.ok(instructions.includes("userscripts/notion-restyle.user.js"));
});
