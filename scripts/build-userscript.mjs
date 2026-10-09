#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import { readRendererPayload } from "./renderer-payload.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUTPUT_DIRECTORY = path.join(root, "userscripts");
export const DEFAULT_UPDATE_URL = "https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js";
export const NOTION_BROWSER_HOSTS = Object.freeze([
  "app.notion.com",
  "www.notion.so",
  "notion.so",
]);

function validateOptions({ version, updateUrl }) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Userscript version must use three numeric components, e.g. 0.1.1");
  }
  if (updateUrl !== undefined) {
    if (typeof updateUrl !== "string" || /\s/.test(updateUrl)) {
      throw new Error("Update URL must be an HTTPS URL without whitespace or credentials");
    }
    let url;
    try { url = new URL(updateUrl); } catch {
      throw new Error("Update URL must be an HTTPS URL without whitespace or credentials");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("Update URL must be an HTTPS URL without whitespace, credentials, or a fragment");
    }
  }
}

export function parseArgs(argv) {
  const options = {};
  const flags = new Map([
    ["--version", "version"],
    ["--update-url", "updateUrl"],
    ["--check", "check"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    if (key in options) throw new Error(`Duplicate argument: ${flag}`);
    if (key === "check") {
      options.check = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  return options;
}

export function renderUserscript({ payload, version, updateUrl = DEFAULT_UPDATE_URL }) {
  validateOptions({ version, updateUrl });
  const metadata = [
    "// ==UserScript==",
    "// @name         Notion Restyle",
    "// @namespace    https://github.com/xupeng/notion-restyle",
    `// @version      ${version}`,
    "// @description  Notion typography and independent content / AI chat zoom",
    "// @homepageURL  https://github.com/xupeng/notion-restyle",
    ...NOTION_BROWSER_HOSTS.map((host) => `// @match        https://${host}/*`),
    "// @run-at       document-end",
    "// @inject-into  content",
    "// @noframes",
    "// @grant        GM_registerMenuCommand",
    `// @updateURL    ${updateUrl}`,
    `// @downloadURL  ${updateUrl}`,
    "// ==/UserScript==",
  ].join("\n");

  const script = `${metadata}

// Generated from assets/notion-custom.css and assets/renderer-inject.js. Do not edit.
(() => {
  "use strict";
  if (
    window.top !== window.self
    || location.protocol !== "https:"
    || !${JSON.stringify(NOTION_BROWSER_HOSTS)}.includes(location.hostname)
    || (location.port && location.port !== "443")
  ) return;

  ${payload};

  if (!window.__NOTION_RESTYLE_MENU_REGISTERED__) {
    GM_registerMenuCommand("Notion Restyle：暂时停用当前页（刷新恢复）", () => {
      window.__NOTION_RESTYLE_STATE__?.cleanup?.();
    });
    window.__NOTION_RESTYLE_MENU_REGISTERED__ = true;
  }
})();
`;
  // Validate generated code before writing an installable artifact.
  new vm.Script(script, { filename: "notion-restyle.user.js" });
  return script;
}

export async function buildUserscript({
  version,
  updateUrl = DEFAULT_UPDATE_URL,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  check = false,
} = {}) {
  if (version === undefined) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    version = manifest.version;
  }
  const built = await readRendererPayload();
  const script = renderUserscript({ ...built, version, updateUrl });
  const outputPath = path.join(outputDirectory, "notion-restyle.user.js");
  if (check) {
    let existing;
    try {
      existing = await fs.readFile(outputPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new Error(`Missing userscript: ${outputPath}. Run npm run build:userscript.`);
    }
    if (existing !== script) {
      throw new Error(`Outdated userscript: ${outputPath}. Run npm run build:userscript.`);
    }
  } else {
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(outputPath, script, "utf8");
  }
  return { outputPath, version, revision: built.revision, checked: check };
}

async function main() {
  const { outputPath, version, checked } = await buildUserscript(parseArgs(process.argv.slice(2)));
  console.log(`${checked ? "Checked" : "Built"} ${outputPath} (version ${version})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`notion-restyle: ${error.message}`);
    process.exitCode = 1;
  });
}
