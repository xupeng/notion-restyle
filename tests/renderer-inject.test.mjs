import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [template, css] = await Promise.all([
  fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8"),
  fs.readFile(path.join(root, "assets", "notion-custom.css"), "utf8"),
]);

function fixture() {
  const nodes = new Map();
  const counts = new Map([
    [".notion-page-content", 1],
    [".notion-collection-item", 2],
    [".layout-chat, .chat_sidebar", 1],
  ]);
  const head = { appendChild(node) { nodes.set(node.id, node); } };
  const document = {
    head,
    documentElement: head,
    createElement() {
      return {
        id: "",
        dataset: {},
        textContent: "",
        remove() { nodes.delete(this.id); },
      };
    },
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll(selector) { return { length: counts.get(selector) || 0 }; },
  };
  const context = { document, window: {} };
  const payload = template
    .replace("__NOTION_RESTYLE_CSS_JSON__", JSON.stringify(css))
    .replace("__NOTION_RESTYLE_VERSION_JSON__", JSON.stringify("test-revision"));
  return { context, nodes, payload };
}

test("the copied CSS retains the existing Notion scopes and Google Fonts import", () => {
  assert.match(css, /fonts\.googleapis\.com/);
  assert.match(css, /div\.notion-page-content \*/);
  assert.match(css, /div\.notion-collection-item \*/);
  assert.match(css, /div\.layout-chat \*/);
  assert.match(css, /div\.chat_sidebar \*/);
  assert.match(css, /div\.notion-code-block div span/);
  assert.match(
    css,
    /div\.notion-collection-item\.notion-collection-item,\s*div\.notion-collection-item\.notion-collection-item \*[\s\S]*?font-weight: 400 !important;/,
  );
  assert.ok(
    css.lastIndexOf("div.notion-collection-item.notion-collection-item *")
      > css.lastIndexOf("div.notion-page-block h3"),
    "the card override must follow the title rule",
  );
  assert.match(
    css,
    /div\.notion-page-block \[role="row"\] \[role="cell"\] span:not\(\[style\*="font-weight"\]\)[\s\S]*?font-weight: 400 !important;/,
  );
});

test("injects, reports target counts, reapplies, and cleans up", () => {
  const current = fixture();
  const first = vm.runInNewContext(current.payload, current.context);
  assert.deepEqual({ ...first }, {
    installed: true,
    version: "test-revision",
    pageContentCount: 1,
    collectionItemCount: 2,
    chatCount: 1,
  });
  assert.equal(current.nodes.size, 1);
  assert.equal(current.nodes.get("notion-restyle-style").textContent, css);

  vm.runInNewContext(current.payload, current.context);
  assert.equal(current.nodes.size, 1, "reapply must leave exactly one style element");
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.cleanup(), true);
  assert.equal(current.nodes.size, 0);
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__, undefined);
});
