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

const ZOOM_STYLE_ID = "notion-restyle-content-zoom-style";
const ZOOM_TOAST_ID = "notion-restyle-content-zoom-toast";
const ZOOM_STORAGE_KEY = "notion-restyle.contentZoomPercent.v1";

function fixture({ storedZoom = null, storageThrows = false } = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map();
  if (storedZoom !== null) storage.set(ZOOM_STORAGE_KEY, storedZoom);
  const counts = new Map([
    [".notion-page-content", 1],
    [".notion-collection-item", 2],
    [".layout-chat, .chat_sidebar", 1],
  ]);
  const rootNode = { appendChild(node) { nodes.set(node.id, node); } };
  const document = {
    head: rootNode,
    body: rootNode,
    documentElement: rootNode,
    createElement() {
      return {
        attributes: {},
        id: "",
        dataset: {},
        textContent: "",
        remove() { nodes.delete(this.id); },
        setAttribute(name, value) { this.attributes[name] = String(value); },
      };
    },
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll(selector) { return { length: counts.get(selector) || 0 }; },
  };
  const window = {
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error("storage unavailable");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageThrows) throw new Error("storage unavailable");
        storage.set(key, String(value));
      },
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  let nextTimer = 1;
  const context = {
    document,
    window,
    setTimeout(callback) {
      const identifier = nextTimer++;
      timers.set(identifier, callback);
      return identifier;
    },
    clearTimeout(identifier) { timers.delete(identifier); },
  };
  const payload = template
    .replace("__NOTION_RESTYLE_CSS_JSON__", JSON.stringify(css))
    .replace("__NOTION_RESTYLE_VERSION_JSON__", JSON.stringify("test-revision"));
  return {
    context,
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    listeners,
    nodes,
    payload,
    storage,
    timers,
  };
}

function keyboardEvent(code, overrides = {}) {
  return {
    altKey: false,
    code,
    ctrlKey: true,
    defaultPrevented: false,
    immediatePropagationStopped: false,
    isComposing: false,
    metaKey: false,
    shiftKey: true,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    ...overrides,
  };
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
    contentZoomPercent: 100,
    pageContentCount: 1,
    collectionItemCount: 2,
    chatCount: 1,
  });
  assert.equal(current.nodes.size, 2);
  assert.equal(current.nodes.get("notion-restyle-style").textContent, css);
  assert.match(current.nodes.get(ZOOM_STYLE_ID).textContent, /zoom: 1 !important/);

  vm.runInNewContext(current.payload, current.context);
  assert.equal(current.nodes.size, 2, "reapply must leave exactly one of each style element");
  assert.equal(current.listeners.get("keydown").size, 1);
  assert.equal(current.listeners.get("storage").size, 1);
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.cleanup(), true);
  assert.equal(current.nodes.size, 0);
  assert.equal(current.listeners.get("keydown").size, 0);
  assert.equal(current.listeners.get("storage").size, 0);
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__, undefined);
});

test("loads valid persisted zoom and falls back for invalid or unavailable storage", () => {
  const persisted = fixture({ storedZoom: "130" });
  const status = vm.runInNewContext(persisted.payload, persisted.context);
  assert.equal(status.contentZoomPercent, 130);
  assert.match(persisted.nodes.get(ZOOM_STYLE_ID).textContent, /zoom: 1\.3 !important/);

  for (const storedZoom of ["59", "161", "90.5", "invalid"]) {
    const invalid = fixture({ storedZoom });
    const invalidStatus = vm.runInNewContext(invalid.payload, invalid.context);
    assert.equal(invalidStatus.contentZoomPercent, 100);
  }

  const unavailable = fixture({ storageThrows: true });
  const unavailableStatus = vm.runInNewContext(unavailable.payload, unavailable.context);
  assert.equal(unavailableStatus.contentZoomPercent, 100);
});

test("handles exact zoom shortcuts, persists changes, resets, and enforces limits", () => {
  const current = fixture();
  vm.runInNewContext(current.payload, current.context);

  const zoomIn = keyboardEvent("Equal");
  current.dispatch("keydown", zoomIn);
  assert.equal(zoomIn.defaultPrevented, true);
  assert.equal(zoomIn.immediatePropagationStopped, true);
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "110");
  assert.equal(current.nodes.get(ZOOM_TOAST_ID).textContent, "正文缩放 110%");

  const zoomOut = keyboardEvent("Minus");
  current.dispatch("keydown", zoomOut);
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "100");

  for (let index = 0; index < 10; index += 1) {
    current.dispatch("keydown", keyboardEvent("Minus"));
  }
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "60");
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 60);

  for (let index = 0; index < 20; index += 1) {
    current.dispatch("keydown", keyboardEvent("Equal"));
  }
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "160");

  current.dispatch("keydown", keyboardEvent("Digit0"));
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "100");
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 100);
});

test("ignores non-matching shortcuts and synchronizes storage changes without a toast", () => {
  const current = fixture();
  vm.runInNewContext(current.payload, current.context);

  const nativeZoom = keyboardEvent("Equal", { ctrlKey: false, metaKey: true });
  current.dispatch("keydown", nativeZoom);
  assert.equal(nativeZoom.defaultPrevented, false);
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 100);

  const composing = keyboardEvent("Equal", { isComposing: true });
  current.dispatch("keydown", composing);
  assert.equal(composing.defaultPrevented, false);

  current.dispatch("storage", { key: ZOOM_STORAGE_KEY, newValue: "140" });
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 140);
  assert.equal(current.nodes.has(ZOOM_TOAST_ID), false);

  current.dispatch("storage", { key: ZOOM_STORAGE_KEY, newValue: "invalid" });
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 100);
});

test("cleanup keeps the persisted zoom preference", () => {
  const current = fixture({ storedZoom: "120" });
  vm.runInNewContext(current.payload, current.context);
  current.dispatch("keydown", keyboardEvent("Equal"));
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "130");

  current.context.window.__NOTION_RESTYLE_STATE__.cleanup();
  assert.equal(current.storage.get(ZOOM_STORAGE_KEY), "130");
  assert.equal(current.nodes.size, 0);
  assert.equal(current.timers.size, 0);
});
