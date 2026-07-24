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
const CONTENT_ZOOM_STORAGE_KEY = "notion-restyle.contentZoomPercent.v1";
const LEGACY_CHAT_ZOOM_STORAGE_KEY = "notion-restyle.chatZoomPercent.v1";
const FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY = "notion-restyle.fullScreenChatZoomPercent.v1";
const SIDEBAR_CHAT_ZOOM_STORAGE_KEY = "notion-restyle.sidebarChatZoomPercent.v1";
const CHAT_ROOT_SELECTOR = ".layout-chat, .chat_sidebar";
const CHAT_BODY_ATTRIBUTE = "data-notion-restyle-chat-zoom-body";
const CHAT_BODY_SELECTOR = `[${CHAT_BODY_ATTRIBUTE}]`;
const FULL_SCREEN_CHAT_BODY_SELECTOR = `[${CHAT_BODY_ATTRIBUTE}="full-screen"]`;
const SIDEBAR_CHAT_BODY_SELECTOR = `[${CHAT_BODY_ATTRIBUTE}="sidebar"]`;
const CHAT_EDITOR_SELECTOR = '[role="textbox"][contenteditable="true"], textarea';
const FEED_CONTENT_SELECTOR = "div.notion-peek-renderer div.notion-collection-view-body div.notion-page-block:not(.notion-collection-item):not(div.notion-page-block div.notion-page-block)";
const AGENT_WRITER_CONTENT_SELECTOR = 'div.notion-agent-writer-ui div[role="group"].whenContentEditable';
const CONTENT_DIVIDER_SELECTOR = [
  'div.notion-page-content div.notion-divider-block [role="separator"]',
  `${FEED_CONTENT_SELECTOR} div.notion-divider-block [role="separator"]`,
  `${AGENT_WRITER_CONTENT_SELECTOR} div.notion-divider-block [role="separator"]`,
].join(",\n");
const CONTENT_IMAGE_SELECTOR = [
  "div.notion-page-content div.notion-image-block img",
  `${FEED_CONTENT_SELECTOR} div.notion-image-block img`,
].join(",\n");

function cssRuleBody(cssText, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cssText.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
}

class FakeElement {
  constructor(tagName = "div", { classes = [], attributes = {}, visible = true } = {}) {
    this.tagName = tagName.toUpperCase();
    this.classList = new Set(classes);
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.visible = visible;
    this.computedStyle = { overflowY: "visible" };
    this.dataset = {};
    this.id = "";
    this.textContent = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    assert.notEqual(index, -1);
    previous.parentElement = null;
    next.parentElement = this;
    this.children[index] = next;
    return previous;
  }

  get firstElementChild() { return this.children[0] || null; }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  getClientRects() { return this.visible ? [{}] : []; }

  hasAttribute(name) { return this.attributes.has(name); }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  removeAttribute(name) { this.attributes.delete(name); }

  matches(selector) {
    if (/^\.[A-Za-z0-9_-]+$/.test(selector)) return this.classList.has(selector.slice(1));
    if (selector === ".layout-chat") return this.classList.has("layout-chat");
    if (selector === ".chat_sidebar") return this.classList.has("chat_sidebar");
    if (selector === CHAT_ROOT_SELECTOR) {
      return this.classList.has("layout-chat") || this.classList.has("chat_sidebar");
    }
    if (selector === CHAT_BODY_SELECTOR) return this.hasAttribute(CHAT_BODY_ATTRIBUTE);
    if (selector === FULL_SCREEN_CHAT_BODY_SELECTOR) {
      return this.getAttribute(CHAT_BODY_ATTRIBUTE) === "full-screen";
    }
    if (selector === SIDEBAR_CHAT_BODY_SELECTOR) {
      return this.getAttribute(CHAT_BODY_ATTRIBUTE) === "sidebar";
    }
    if (selector === "textarea") return this.tagName === "TEXTAREA";
    if (selector === '[role="textbox"][contenteditable="true"]') {
      return this.getAttribute("role") === "textbox"
        && this.getAttribute("contenteditable") === "true";
    }
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const selectors = selector === CHAT_EDITOR_SELECTOR
      ? ['[role="textbox"][contenteditable="true"]', "textarea"]
      : [selector];
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selectors.some((candidate) => child.matches(candidate))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

function fixture({
  storedContentZoom = null,
  storedLegacyChatZoom = null,
  storedFullScreenChatZoom = null,
  storedSidebarChatZoom = null,
  storageThrows = false,
  fullScreenChat = false,
  emptyViewport = false,
  missingEditor = false,
  missingHistory = false,
  nestedChat = false,
  textareaEditor = false,
} = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const timers = new Map();
  const animationFrames = new Map();
  const observers = new Set();
  const storage = new Map();
  if (storedContentZoom !== null) storage.set(CONTENT_ZOOM_STORAGE_KEY, storedContentZoom);
  if (storedLegacyChatZoom !== null) storage.set(LEGACY_CHAT_ZOOM_STORAGE_KEY, storedLegacyChatZoom);
  if (storedFullScreenChatZoom !== null) {
    storage.set(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY, storedFullScreenChatZoom);
  }
  if (storedSidebarChatZoom !== null) {
    storage.set(SIDEBAR_CHAT_ZOOM_STORAGE_KEY, storedSidebarChatZoom);
  }

  const documentElement = new FakeElement("html");
  const head = documentElement.appendChild(new FakeElement("head"));
  const body = documentElement.appendChild(new FakeElement("body"));
  const contentTarget = body.appendChild(new FakeElement("main"));
  const pageContent = contentTarget.appendChild(new FakeElement("div", {
    classes: ["notion-page-content"],
  }));
  pageContent.appendChild(new FakeElement("div", { classes: ["notion-collection-item"] }));
  pageContent.appendChild(new FakeElement("div", { classes: ["notion-collection-item"] }));

  const chatRoot = body.appendChild(new FakeElement("div", {
    classes: [fullScreenChat ? "layout-chat" : "chat_sidebar"],
  }));
  const chatHeader = chatRoot.appendChild(new FakeElement("header"));
  const chatLayout = chatRoot.appendChild(new FakeElement("div"));
  const historyViewport = missingHistory ? null : chatLayout.appendChild(new FakeElement("div"));
  if (historyViewport) historyViewport.computedStyle.overflowY = "auto";
  let messageHost = historyViewport && !emptyViewport
    ? historyViewport.appendChild(new FakeElement("div"))
    : null;
  messageHost?.appendChild(new FakeElement("div", { classes: ["notion-selectable-container"] }));
  const composer = chatLayout.appendChild(new FakeElement("div"));
  const chatTarget = missingEditor
    ? composer
    : composer.appendChild(textareaEditor
      ? new FakeElement("textarea")
      : new FakeElement("div", {
        attributes: { role: "textbox", contenteditable: "true" },
      }));
  const chatButton = composer.appendChild(new FakeElement("button"));

  let nestedRoot = null;
  let nestedMessageHost = null;
  if (nestedChat) {
    nestedRoot = messageHost.appendChild(new FakeElement("div", { classes: ["layout-chat"] }));
    const nestedLayout = nestedRoot.appendChild(new FakeElement("div"));
    const nestedViewport = nestedLayout.appendChild(new FakeElement("div"));
    nestedViewport.computedStyle.overflowY = "auto";
    nestedMessageHost = nestedViewport.appendChild(new FakeElement("div"));
    const nestedComposer = nestedLayout.appendChild(new FakeElement("div"));
    nestedComposer.appendChild(new FakeElement("div", {
      attributes: { role: "textbox", contenteditable: "true" },
    }));
  }

  const document = {
    activeElement: contentTarget,
    head,
    body,
    documentElement,
    createElement() {
      const element = new FakeElement();
      element.remove = () => {
        nodes.delete(element.id);
        FakeElement.prototype.remove.call(element);
      };
      return element;
    },
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === ".notion-page-content") return [pageContent];
      if (selector === ".notion-collection-item") return pageContent.querySelectorAll(selector);
      const matches = [];
      if (documentElement.matches(selector)) matches.push(documentElement);
      return matches.concat(documentElement.querySelectorAll(selector));
    },
  };
  const indexAppendedNode = (append, node) => {
    append(node);
    if (node.id) nodes.set(node.id, node);
    return node;
  };
  const appendToHead = head.appendChild.bind(head);
  const appendToBody = body.appendChild.bind(body);
  head.appendChild = (node) => indexAppendedNode(appendToHead, node);
  body.appendChild = (node) => indexAppendedNode(appendToBody, node);

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.add(this);
    }

    observe() { this.connected = true; }

    disconnect() { this.connected = false; }
  }

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
  let nextAnimationFrame = 1;
  const context = {
    document,
    MutationObserver: FakeMutationObserver,
    window,
    getComputedStyle(element) { return element.computedStyle; },
    requestAnimationFrame(callback) {
      const identifier = nextAnimationFrame++;
      animationFrames.set(identifier, callback);
      return identifier;
    },
    cancelAnimationFrame(identifier) { animationFrames.delete(identifier); },
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
    animationFrames,
    chatButton,
    chatHeader,
    chatRoot,
    chatTarget,
    contentTarget,
    context,
    dispatch(type, event) {
      if (type === "focusin") document.activeElement = event.target;
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    listeners,
    messageHost,
    nestedMessageHost,
    nodes,
    observers,
    payload,
    replaceMessageHost() {
      assert.ok(historyViewport && messageHost);
      const next = new FakeElement("div");
      historyViewport.replaceChild(next, messageHost);
      messageHost = next;
      return next;
    },
    flushAnimationFrames() {
      const pending = [...animationFrames.entries()];
      animationFrames.clear();
      for (const [, callback] of pending) callback();
    },
    storage,
    timers,
    triggerMutation() {
      for (const observer of observers) {
        if (observer.connected) observer.callback([{ type: "childList" }], observer);
      }
    },
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
    target: null,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.immediatePropagationStopped = true; },
    ...overrides,
  };
}

test("the copied CSS retains the existing Notion scopes and Google Fonts import", () => {
  assert.match(css, /fonts\.googleapis\.com/);
  assert.match(css, /div\.notion-page-content \*/);
  assert.match(
    css,
    /div\.notion-collection-view-body :where\(div\.notion-page-block:not\(\.notion-collection-item\)\) \*/,
  );
  assert.match(
    css,
    /div\.notion-peek-renderer div\.notion-collection-view-body\s+:where\(div\.notion-page-block:not\(\.notion-collection-item\):not\(div\.notion-page-block div\.notion-page-block\)\)\s+:where\(div\.notion-selectable:not\(\.notion-page-block\)\)\s*\{[\s\S]*?font-size: 16px !important;/,
  );
  assert.doesNotMatch(css, /div\.notion-peek-renderer \*\s*\{[\s\S]*?font-size:/);
  assert.match(css, /div\.notion-collection-item \*/);
  assert.match(css, /div\.layout-chat \*/);
  assert.match(css, /div\.chat_sidebar \*/);
  assert.match(css, /div\.notion-code-block div span/);
  assert.doesNotMatch(
    css,
    /div\.notion-page-block (?:div|span|h[1-3])\s*[,\{]/,
  );
  assert.match(css, /div\.notion-header-block h1,/);
  assert.match(css, /div\.notion-sub_header-block h3,/);
  assert.match(
    css,
    /div\.notion-sub_sub_header-block h3\s*\{[\s\S]*?font-weight: 500 !important;/,
  );
  const pageTitleRule = css.match(
    /div\.notion-page-block:not\(\.notion-collection-item\) a > div\[role="button"\],\s*div\.notion-page-block:not\(\.notion-collection-item\) a > div\[role="button"\] \*\s*\{([^}]*)\}/,
  );
  assert.ok(pageTitleRule, "page titles must use a semantic selector");
  assert.match(pageTitleRule[1], /font-family:/);
  assert.doesNotMatch(pageTitleRule[1], /font-weight:/);
  assert.match(
    css,
    /div\.notion-collection-item\.notion-collection-item,\s*div\.notion-collection-item\.notion-collection-item \*[\s\S]*?font-weight: 400 !important;/,
  );
  assert.ok(
    css.lastIndexOf("div.notion-collection-item.notion-collection-item *")
      > css.lastIndexOf('div.notion-page-block:not(.notion-collection-item) a > div[role="button"] *'),
    "the card override must follow the title rule",
  );
  assert.match(
    css,
    /div\.notion-page-block \[role="row"\] \[role="cell"\] span:not\(\[style\*="font-weight"\]\)[\s\S]*?font-weight: 400 !important;/,
  );
});

test("Agent writer content uses slightly smaller scoped body typography", () => {
  assert.match(
    css,
    /div\.notion-agent-writer-ui :where\(div\[role="group"\]\.whenContentEditable\) \*\s*\{[\s\S]*?font-family: "Caecilia LT Std", "Pridi", "NotionRestyleBodyCJK", "Noto Sans SC", STKaiti, -apple-system,[\s\S]*?line-height: 1\.8em !important;/,
  );
  assert.match(
    css,
    /div\.notion-agent-writer-ui :where\(div\[role="group"\]\.whenContentEditable\)\s+:where\(div\.notion-selectable:not\(\.notion-page-block\)\)\s*\{[\s\S]*?font-size: 15px !important;/,
  );
  assert.doesNotMatch(
    css,
    /div\.notion-agent-writer-ui\s+\*\s*\{[^}]*font-size:/,
  );
  assert.ok(
    css.lastIndexOf("div.notion-code-block div span")
      > css.lastIndexOf('div.notion-agent-writer-ui :where(div[role="group"].whenContentEditable)'),
    "the code font override must follow the scoped Agent writer typography",
  );
});

test("Agent writer shell uses only the secondary themed background", () => {
  const shellRule = cssRuleBody(css, "div.notion-agent-writer-ui");

  assert.ok(shellRule, "missing the Agent writer shell background rule");
  assert.match(
    shellRule,
    /background-color:\s*var\(--c-bacSec\)\s*!important/,
  );
  assert.doesNotMatch(
    shellRule,
    /(?:font-family|font-size|line-height|zoom)\s*:/,
  );
});

test("divider line is 100px and centered without shrinking its selectable block", () => {
  const dividerRule = cssRuleBody(css, 'div.notion-divider-block [role="separator"]');

  assert.ok(dividerRule, "missing the semantic divider line rule");
  assert.match(dividerRule, /width:\s*100px\s*!important/);
  assert.match(dividerRule, /height:\s*2px\s*!important/);
  assert.match(dividerRule, /margin-inline:\s*auto\s*!important/);
  assert.doesNotMatch(
    css,
    /div\.notion-divider-block\s*\{[^}]*(?:width|zoom|transform)\s*:/,
  );
});

test("divider visual thickness stays at two pixels across content zoom levels", () => {
  const current = fixture();
  vm.runInNewContext(current.payload, current.context);

  const dividerHeightAt = (zoomPercent) => {
    const rule = cssRuleBody(
      current.nodes.get(ZOOM_STYLE_ID).textContent,
      CONTENT_DIVIDER_SELECTOR,
    );
    const height = Number(rule?.match(/height:\s*([0-9.]+)px\s*!important/)?.[1]);
    assert.ok(Number.isFinite(height), `missing divider height at ${zoomPercent}%`);
    return height * (zoomPercent / 100);
  };

  assert.ok(Math.abs(dividerHeightAt(100) - 2) < 1e-9);
  current.dispatch("storage", { key: CONTENT_ZOOM_STORAGE_KEY, newValue: "130" });
  assert.ok(Math.abs(dividerHeightAt(130) - 2) < 1e-9);
  current.dispatch("storage", { key: CONTENT_ZOOM_STORAGE_KEY, newValue: "80" });
  assert.ok(Math.abs(dividerHeightAt(80) - 2) < 1e-9);
});

test("injects, reports target counts, reapplies, and cleans up", () => {
  const current = fixture();
  const first = vm.runInNewContext(current.payload, current.context);
  assert.deepEqual({ ...first }, {
    installed: true,
    version: "test-revision",
    contentZoomPercent: 100,
    fullScreenChatZoomPercent: 100,
    sidebarChatZoomPercent: 100,
    pageContentCount: 1,
    collectionItemCount: 2,
    chatCount: 1,
  });
  assert.equal(current.nodes.size, 2);
  assert.equal(current.nodes.get("notion-restyle-style").textContent, css);
  assert.match(current.nodes.get(ZOOM_STYLE_ID).textContent, /zoom: 1 !important/);
  assert.equal(current.messageHost.getAttribute(CHAT_BODY_ATTRIBUTE), "sidebar");
  assert.equal([...current.observers].filter((observer) => observer.connected).length, 1);

  vm.runInNewContext(current.payload, current.context);
  assert.equal(current.nodes.size, 2, "reapply must leave exactly one of each style element");
  assert.equal(current.listeners.get("keydown").size, 1);
  assert.equal(current.listeners.get("storage").size, 1);
  assert.equal(current.listeners.get("pointerdown").size, 1);
  assert.equal(current.listeners.get("focusin").size, 1);
  assert.equal([...current.observers].filter((observer) => observer.connected).length, 1);
  assert.equal(current.messageHost.getAttribute(CHAT_BODY_ATTRIBUTE), "sidebar");
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.cleanup(), true);
  assert.equal(current.nodes.size, 0);
  assert.equal(current.listeners.get("keydown").size, 0);
  assert.equal(current.listeners.get("storage").size, 0);
  assert.equal(current.listeners.get("pointerdown").size, 0);
  assert.equal(current.listeners.get("focusin").size, 0);
  assert.equal([...current.observers].filter((observer) => observer.connected).length, 0);
  assert.equal(current.animationFrames.size, 0);
  assert.equal(current.messageHost.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__, undefined);
});

test("loads three persisted zoom levels and migrates the legacy shared chat value", () => {
  const persisted = fixture({
    storedContentZoom: "130",
    storedLegacyChatZoom: "85",
    storedFullScreenChatZoom: "120",
    storedSidebarChatZoom: "75",
  });
  const status = vm.runInNewContext(persisted.payload, persisted.context);
  assert.equal(status.contentZoomPercent, 130);
  assert.equal(status.fullScreenChatZoomPercent, 120);
  assert.equal(status.sidebarChatZoomPercent, 75);
  assert.match(persisted.nodes.get(ZOOM_STYLE_ID).textContent, /zoom: 1\.3 !important/);
  assert.match(
    cssRuleBody(persisted.nodes.get(ZOOM_STYLE_ID).textContent, FEED_CONTENT_SELECTOR),
    /zoom: 1\.3 !important/,
  );
  assert.match(
    cssRuleBody(
      persisted.nodes.get(ZOOM_STYLE_ID).textContent,
      AGENT_WRITER_CONTENT_SELECTOR,
    ),
    /zoom: 1\.3 !important/,
  );
  assert.equal(
    cssRuleBody(
      persisted.nodes.get(ZOOM_STYLE_ID).textContent,
      "div.notion-agent-writer-ui",
    ),
    null,
  );
  assert.match(
    cssRuleBody(persisted.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    /height: auto !important/,
  );
  assert.match(
    cssRuleBody(persisted.nodes.get(ZOOM_STYLE_ID).textContent, FULL_SCREEN_CHAT_BODY_SELECTOR),
    /zoom: 1\.2 !important/,
  );
  assert.match(
    cssRuleBody(persisted.nodes.get(ZOOM_STYLE_ID).textContent, SIDEBAR_CHAT_BODY_SELECTOR),
    /zoom: 0\.75 !important/,
  );

  const migrated = fixture({ storedLegacyChatZoom: "85" });
  const migratedStatus = vm.runInNewContext(migrated.payload, migrated.context);
  assert.equal(migratedStatus.fullScreenChatZoomPercent, 85);
  assert.equal(migratedStatus.sidebarChatZoomPercent, 85);

  for (const storedZoom of ["59", "161", "90.5", "invalid"]) {
    const invalid = fixture({
      storedContentZoom: storedZoom,
      storedFullScreenChatZoom: "115",
      storedSidebarChatZoom: "85",
    });
    const invalidStatus = vm.runInNewContext(invalid.payload, invalid.context);
    assert.equal(invalidStatus.contentZoomPercent, 100);
    assert.equal(invalidStatus.fullScreenChatZoomPercent, 115);
    assert.equal(invalidStatus.sidebarChatZoomPercent, 85);

    const invalidChat = fixture({
      storedContentZoom: "115",
      storedLegacyChatZoom: "90",
      storedFullScreenChatZoom: storedZoom,
      storedSidebarChatZoom: "80",
    });
    const invalidChatStatus = vm.runInNewContext(invalidChat.payload, invalidChat.context);
    assert.equal(invalidChatStatus.contentZoomPercent, 115);
    assert.equal(invalidChatStatus.fullScreenChatZoomPercent, 100);
    assert.equal(invalidChatStatus.sidebarChatZoomPercent, 80);
  }

  const unavailable = fixture({ storageThrows: true });
  const unavailableStatus = vm.runInNewContext(unavailable.payload, unavailable.context);
  assert.equal(unavailableStatus.contentZoomPercent, 100);
  assert.equal(unavailableStatus.fullScreenChatZoomPercent, 100);
  assert.equal(unavailableStatus.sidebarChatZoomPercent, 100);
});

test("uses five-percent steps and keeps content and sidebar chat independent", () => {
  const current = fixture();
  vm.runInNewContext(current.payload, current.context);

  const zoomIn = keyboardEvent("Equal");
  current.dispatch("keydown", zoomIn);
  assert.equal(zoomIn.defaultPrevented, true);
  assert.equal(zoomIn.immediatePropagationStopped, true);
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "105");
  assert.equal(current.storage.has(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), false);
  assert.equal(current.storage.has(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY), false);
  assert.equal(current.nodes.get(ZOOM_TOAST_ID).textContent, "正文缩放 105%");
  assert.match(
    cssRuleBody(current.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    /height: auto !important/,
  );

  current.dispatch("pointerdown", { target: current.chatTarget });
  current.dispatch("keydown", keyboardEvent("Minus"));
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "105");
  assert.equal(current.storage.get(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), "95");
  assert.equal(current.storage.has(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY), false);
  assert.equal(current.nodes.get(ZOOM_TOAST_ID).textContent, "侧栏 AI 对话缩放 95%");
  assert.match(
    cssRuleBody(current.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    /height: auto !important/,
  );

  current.dispatch("keydown", keyboardEvent("Digit0"));
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "105");
  assert.equal(current.storage.get(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), "100");
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    100,
  );
});

test("routes shortcuts by recent pointer or focus activity and enforces both limits", () => {
  const current = fixture();
  vm.runInNewContext(current.payload, current.context);

  current.dispatch("pointerdown", { target: current.chatTarget });
  current.dispatch("keydown", keyboardEvent("Equal"));
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    105,
  );

  current.dispatch("pointerdown", { target: current.contentTarget });
  current.dispatch("keydown", keyboardEvent("Minus"));
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 95);

  current.dispatch("focusin", { target: current.chatTarget });
  current.dispatch("keydown", keyboardEvent("Minus"));
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    100,
  );

  current.dispatch("pointerdown", { target: current.contentTarget });
  for (let index = 0; index < 20; index += 1) {
    current.dispatch("keydown", keyboardEvent("Minus"));
  }
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "60");
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 60);

  current.dispatch("pointerdown", { target: current.chatTarget });
  for (let index = 0; index < 30; index += 1) {
    current.dispatch("keydown", keyboardEvent("Equal"));
  }
  assert.equal(current.storage.get(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), "160");
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    160,
  );
});

test("full-screen chat always receives its own zoom shortcuts", () => {
  const current = fixture({ fullScreenChat: true, storedSidebarChatZoom: "80" });
  vm.runInNewContext(current.payload, current.context);

  current.dispatch("keydown", keyboardEvent("Equal"));
  const status = current.context.window.__NOTION_RESTYLE_STATE__.status();
  assert.equal(status.contentZoomPercent, 100);
  assert.equal(status.fullScreenChatZoomPercent, 105);
  assert.equal(status.sidebarChatZoomPercent, 80);
  assert.equal(current.storage.get(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY), "105");
  assert.equal(current.storage.has(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), true);
  assert.equal(current.nodes.get(ZOOM_TOAST_ID).textContent, "全屏 AI 对话缩放 105%");
});

test("zooms only the marked message host in sidebar and full-screen chat", () => {
  for (const fullScreenChat of [false, true]) {
    const current = fixture({
      storedFullScreenChatZoom: fullScreenChat ? "125" : "80",
      storedSidebarChatZoom: fullScreenChat ? "80" : "125",
      fullScreenChat,
    });
    vm.runInNewContext(current.payload, current.context);
    const zoomCss = current.nodes.get(ZOOM_STYLE_ID).textContent;
    const selector = fullScreenChat
      ? FULL_SCREEN_CHAT_BODY_SELECTOR
      : SIDEBAR_CHAT_BODY_SELECTOR;
    const bodyRule = cssRuleBody(zoomCss, selector);

    assert.equal(
      current.messageHost.getAttribute(CHAT_BODY_ATTRIBUTE),
      fullScreenChat ? "full-screen" : "sidebar",
    );
    assert.equal(current.chatRoot.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
    assert.equal(current.chatHeader.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
    assert.equal(current.chatTarget.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
    assert.equal(current.chatButton.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
    assert.match(bodyRule, /zoom: 1\.25 !important/);
    assert.doesNotMatch(bodyRule, /scale|width|height|flex|margin|transform-origin|max-width|max-height/);
    assert.doesNotMatch(zoomCss, /\bscale:|transform-origin|margin-inline/);
  }
});

test("supports reduced chat zoom and emits no chat rule at one hundred percent", () => {
  const reduced = fixture({
    storedFullScreenChatZoom: "80",
    storedSidebarChatZoom: "100",
  });
  vm.runInNewContext(reduced.payload, reduced.context);
  assert.match(
    cssRuleBody(
      reduced.nodes.get(ZOOM_STYLE_ID).textContent,
      FULL_SCREEN_CHAT_BODY_SELECTOR,
    ),
    /zoom: 0\.8 !important/,
  );
  assert.equal(
    cssRuleBody(reduced.nodes.get(ZOOM_STYLE_ID).textContent, SIDEBAR_CHAT_BODY_SELECTOR),
    null,
  );

  const reset = fixture({
    storedFullScreenChatZoom: "100",
    storedSidebarChatZoom: "100",
  });
  vm.runInNewContext(reset.payload, reset.context);
  const resetCss = reset.nodes.get(ZOOM_STYLE_ID).textContent;
  assert.equal(cssRuleBody(resetCss, FULL_SCREEN_CHAT_BODY_SELECTOR), null);
  assert.equal(cssRuleBody(resetCss, SIDEBAR_CHAT_BODY_SELECTOR), null);
  assert.equal(cssRuleBody(resetCss, CONTENT_IMAGE_SELECTOR), null);
  assert.match(resetCss, /div\.notion-page-content\s*{[\s\S]*?zoom: 1 !important/);
  assert.match(cssRuleBody(resetCss, FEED_CONTENT_SELECTOR), /zoom: 1 !important/);
  assert.match(
    cssRuleBody(resetCss, AGENT_WRITER_CONTENT_SELECTOR),
    /zoom: 1 !important/,
  );
  assert.equal(cssRuleBody(resetCss, "div.notion-agent-writer-ui"), null);
  assert.match(FEED_CONTENT_SELECTOR, /:not\(div\.notion-page-block div\.notion-page-block\)/);
});

test("preserves content image aspect ratios only while content is enlarged", () => {
  const current = fixture({
    storedContentZoom: "130",
    storedFullScreenChatZoom: "120",
    storedSidebarChatZoom: "80",
  });
  vm.runInNewContext(current.payload, current.context);

  const enlargedRule = cssRuleBody(
    current.nodes.get(ZOOM_STYLE_ID).textContent,
    CONTENT_IMAGE_SELECTOR,
  );
  assert.match(enlargedRule, /height: auto !important/);
  assert.doesNotMatch(enlargedRule, /(^|\s)(width|max-width):|object-fit|overflow/);

  current.dispatch("storage", { key: SIDEBAR_CHAT_ZOOM_STORAGE_KEY, newValue: "125" });
  assert.equal(
    cssRuleBody(current.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    enlargedRule,
  );

  current.dispatch("storage", { key: CONTENT_ZOOM_STORAGE_KEY, newValue: "80" });
  assert.equal(
    cssRuleBody(current.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    null,
  );

  current.dispatch("pointerdown", { target: current.contentTarget });
  current.dispatch("keydown", keyboardEvent("Digit0"));
  assert.equal(
    cssRuleBody(current.nodes.get(ZOOM_STYLE_ID).textContent, CONTENT_IMAGE_SELECTOR),
    null,
  );
});

test("reconciles replaced message hosts and ignores nested or incomplete chat layouts", () => {
  const dynamic = fixture({ nestedChat: true });
  vm.runInNewContext(dynamic.payload, dynamic.context);
  const previousHost = dynamic.messageHost;
  const nextHost = dynamic.replaceMessageHost();

  dynamic.triggerMutation();
  dynamic.triggerMutation();
  assert.equal(dynamic.animationFrames.size, 1, "mutations must coalesce into one frame");
  dynamic.flushAnimationFrames();
  assert.equal(previousHost.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
  assert.equal(nextHost.getAttribute(CHAT_BODY_ATTRIBUTE), "sidebar");
  assert.equal(dynamic.nestedMessageHost.hasAttribute(CHAT_BODY_ATTRIBUTE), false);

  const textarea = fixture({ textareaEditor: true });
  vm.runInNewContext(textarea.payload, textarea.context);
  assert.equal(textarea.messageHost.getAttribute(CHAT_BODY_ATTRIBUTE), "sidebar");

  for (const options of [
    { emptyViewport: true },
    { missingEditor: true },
    { missingHistory: true },
  ]) {
    const incomplete = fixture(options);
    vm.runInNewContext(incomplete.payload, incomplete.context);
    assert.equal(incomplete.context.document.querySelectorAll(CHAT_BODY_SELECTOR).length, 0);
  }
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

  current.dispatch("storage", { key: CONTENT_ZOOM_STORAGE_KEY, newValue: "140" });
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 140);
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().fullScreenChatZoomPercent,
    100,
  );
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    100,
  );
  assert.equal(current.nodes.has(ZOOM_TOAST_ID), false);

  current.dispatch("storage", { key: FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY, newValue: "85" });
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 140);
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().fullScreenChatZoomPercent,
    85,
  );
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    100,
  );

  current.dispatch("storage", { key: SIDEBAR_CHAT_ZOOM_STORAGE_KEY, newValue: "75" });
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().fullScreenChatZoomPercent,
    85,
  );
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    75,
  );

  current.dispatch("storage", { key: LEGACY_CHAT_ZOOM_STORAGE_KEY, newValue: "65" });
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().fullScreenChatZoomPercent,
    85,
  );
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    75,
  );

  current.dispatch("storage", { key: CONTENT_ZOOM_STORAGE_KEY, newValue: "invalid" });
  assert.equal(current.context.window.__NOTION_RESTYLE_STATE__.status().contentZoomPercent, 100);
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().fullScreenChatZoomPercent,
    85,
  );
  assert.equal(
    current.context.window.__NOTION_RESTYLE_STATE__.status().sidebarChatZoomPercent,
    75,
  );
});

test("cleanup keeps all three persisted zoom preferences", () => {
  const current = fixture({
    storedContentZoom: "120",
    storedFullScreenChatZoom: "85",
    storedSidebarChatZoom: "80",
  });
  vm.runInNewContext(current.payload, current.context);
  current.dispatch("keydown", keyboardEvent("Equal"));
  current.dispatch("pointerdown", { target: current.chatTarget });
  current.dispatch("keydown", keyboardEvent("Minus"));
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "125");
  assert.equal(current.storage.get(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY), "85");
  assert.equal(current.storage.get(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), "75");
  assert.equal(current.messageHost.hasAttribute(CHAT_BODY_ATTRIBUTE), true);

  current.context.window.__NOTION_RESTYLE_STATE__.cleanup();
  assert.equal(current.storage.get(CONTENT_ZOOM_STORAGE_KEY), "125");
  assert.equal(current.storage.get(FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY), "85");
  assert.equal(current.storage.get(SIDEBAR_CHAT_ZOOM_STORAGE_KEY), "75");
  assert.equal(current.nodes.size, 0);
  assert.equal(current.timers.size, 0);
  assert.equal(current.animationFrames.size, 0);
  assert.equal(current.messageHost.hasAttribute(CHAT_BODY_ATTRIBUTE), false);
  assert.equal([...current.observers].filter((observer) => observer.connected).length, 0);
});
