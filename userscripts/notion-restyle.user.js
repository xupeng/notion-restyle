// ==UserScript==
// @name         Notion Restyle
// @namespace    https://github.com/xupeng/notion-restyle
// @version      0.1.1
// @description  Notion typography and independent content / AI chat zoom
// @homepageURL  https://github.com/xupeng/notion-restyle
// @match        https://app.notion.com/*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @run-at       document-end
// @inject-into  content
// @noframes
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js
// @downloadURL  https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js
// ==/UserScript==

// Generated from assets/notion-custom.css and assets/renderer-inject.js. Do not edit.
(() => {
  "use strict";
  if (
    window.top !== window.self
    || location.protocol !== "https:"
    || !["app.notion.com","www.notion.so","notion.so"].includes(location.hostname)
    || (location.port && location.port !== "443")
  ) return;

  ((cssText, version) => {
  const STATE_KEY = "__NOTION_RESTYLE_STATE__";
  const STYLE_ID = "notion-restyle-style";
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
  const FEED_PREVIEW_SELECTOR = `${FEED_CONTENT_SELECTOR} div[style*="overflow-y: hidden"][style*="max-height: 500px"]`;
  const AGENT_WRITER_CONTENT_SELECTOR = 'div.notion-agent-writer-ui div[role="group"].whenContentEditable';
  const PEEK_TABLE_SELECTOR = ["div.layout-center-peek", "div.layout-side-peek"]
    .map((layout) => (
      `${layout} div.notion-page-content div.notion-table-block:not(div.notion-table-block div.notion-table-block)`
    ))
    .join(",\n");
  const PEEK_TABLE_CONTENT_SELECTOR = `${PEEK_TABLE_SELECTOR} .notion-table-content > div.notion-table-block`;
  const EDIT_REFERENCE_BLOCK_SELECTOR = "div.notion-edit_reference-block:not(div.notion-edit_reference-block div.notion-edit_reference-block)";
  const EDIT_REFERENCE_PRIMARY_ACTION_SELECTOR = '[data-edit-reference-id] > :first-child > :last-child > [role="button"]:first-child';
  const CONTENT_DIVIDER_SELECTOR = [
    'div.notion-page-content div.notion-divider-block [role="separator"]',
    `${FEED_CONTENT_SELECTOR} div.notion-divider-block [role="separator"]`,
    `${AGENT_WRITER_CONTENT_SELECTOR} div.notion-divider-block [role="separator"]`,
  ].join(",\n");
  const CONTENT_IMAGE_SELECTOR = [
    "div.notion-page-content div.notion-image-block img",
    `${FEED_CONTENT_SELECTOR} div.notion-image-block img`,
  ].join(",\n");
  const DIVIDER_VISUAL_HEIGHT_PX = 2;
  const DEFAULT_ZOOM_PERCENT = 100;
  const MIN_ZOOM_PERCENT = 60;
  const MAX_ZOOM_PERCENT = 160;
  const ZOOM_STEP_PERCENT = 5;

  window[STATE_KEY]?.cleanup?.();

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== cssText) style.textContent = cssText;
  style.dataset.notionRestyleVersion = version;

  const parseZoomPercent = (value) => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return DEFAULT_ZOOM_PERCENT;
    const parsed = Number(value);
    return Number.isInteger(parsed)
      && parsed >= MIN_ZOOM_PERCENT
      && parsed <= MAX_ZOOM_PERCENT
      ? parsed
      : DEFAULT_ZOOM_PERCENT;
  };

  const readZoomPercent = (storageKey, fallback = DEFAULT_ZOOM_PERCENT) => {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === null ? fallback : parseZoomPercent(value);
    } catch {
      return DEFAULT_ZOOM_PERCENT;
    }
  };

  let contentZoomPercent = readZoomPercent(CONTENT_ZOOM_STORAGE_KEY);
  const legacyChatZoomPercent = readZoomPercent(LEGACY_CHAT_ZOOM_STORAGE_KEY);
  let fullScreenChatZoomPercent = readZoomPercent(
    FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY,
    legacyChatZoomPercent,
  );
  let sidebarChatZoomPercent = readZoomPercent(
    SIDEBAR_CHAT_ZOOM_STORAGE_KEY,
    legacyChatZoomPercent,
  );
  let lastZoomTarget = "content";
  let toastTimer = null;
  let chatBodyObserver = null;
  let chatBodyFrame = null;
  const markedChatBodies = new Set();
  let zoomStyle = document.getElementById(ZOOM_STYLE_ID);
  if (!zoomStyle) {
    zoomStyle = document.createElement("style");
    zoomStyle.id = ZOOM_STYLE_ID;
    (document.head || document.documentElement).appendChild(zoomStyle);
  }
  zoomStyle.dataset.notionRestyleVersion = version;

  const updateZoomStyle = () => {
    const contentFactor = String(contentZoomPercent / 100);
    const dividerHeight = String(
      (DIVIDER_VISUAL_HEIGHT_PX * 100) / contentZoomPercent,
    );
    const contentImageCss = contentZoomPercent > DEFAULT_ZOOM_PERCENT
      ? `
${CONTENT_IMAGE_SELECTOR} {
  height: auto !important;
}
`
      : "";
    const feedPreviewCss = contentZoomPercent > DEFAULT_ZOOM_PERCENT
      ? `
${FEED_PREVIEW_SELECTOR} {
  max-height: 501px !important;
}
`
      : "";
    const zoomRule = (selector, percent) => (
      percent === DEFAULT_ZOOM_PERCENT
        ? ""
        : `
${selector} {
  zoom: ${String(percent / 100)} !important;
}
`
    );
    // Peek tables have a viewport-sized shell with native page gutters.
    // Keep that shell unscaled, then restore content zoom inside its scroller.
    const peekTableCss = contentZoomPercent === DEFAULT_ZOOM_PERCENT
      ? ""
      : [
        zoomRule(PEEK_TABLE_SELECTOR, DEFAULT_ZOOM_PERCENT * DEFAULT_ZOOM_PERCENT / contentZoomPercent),
        zoomRule(PEEK_TABLE_CONTENT_SELECTOR, contentZoomPercent),
      ].join("");
    const inverseZoomRule = (bodySelector, percent) => (
      percent === DEFAULT_ZOOM_PERCENT
        ? ""
        : `
${bodySelector} ${EDIT_REFERENCE_BLOCK_SELECTOR} {
  zoom: ${String(DEFAULT_ZOOM_PERCENT / percent)} !important;
}
/* The card container provides the same native EditReference action without the zoom-sensitive button gate. */
${bodySelector} ${EDIT_REFERENCE_PRIMARY_ACTION_SELECTOR} {
  pointer-events: none !important;
}
`
    );
    // The message host carries Notion's max-width, so zoom its children to keep text within the composer width.
    const chatZoomCss = [
      zoomRule(`${FULL_SCREEN_CHAT_BODY_SELECTOR} > *`, fullScreenChatZoomPercent),
      inverseZoomRule(FULL_SCREEN_CHAT_BODY_SELECTOR, fullScreenChatZoomPercent),
      zoomRule(`${SIDEBAR_CHAT_BODY_SELECTOR} > *`, sidebarChatZoomPercent),
      inverseZoomRule(SIDEBAR_CHAT_BODY_SELECTOR, sidebarChatZoomPercent),
    ].join("");
    zoomStyle.textContent = `
div.notion-page-content {
  zoom: ${contentFactor} !important;
}
${peekTableCss}
${FEED_CONTENT_SELECTOR} {
  zoom: ${contentFactor} !important;
}
${feedPreviewCss}
${AGENT_WRITER_CONTENT_SELECTOR} {
  zoom: ${contentFactor} !important;
}
${CONTENT_DIVIDER_SELECTOR} {
  height: ${dividerHeight}px !important;
}
${contentImageCss}
${chatZoomCss}

#${ZOOM_TOAST_ID} {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 2147483647;
  transform: translateX(-50%);
  padding: 8px 12px;
  border-radius: 8px;
  color: white;
  background: rgba(30, 30, 30, 0.88);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: none;
}
`;
  };

  const clearChatBodyMarkers = () => {
    for (const node of markedChatBodies) node.removeAttribute(CHAT_BODY_ATTRIBUTE);
    markedChatBodies.clear();
    for (const node of document.querySelectorAll(CHAT_BODY_SELECTOR)) {
      node.removeAttribute(CHAT_BODY_ATTRIBUTE);
    }
  };

  const isVisibleElement = (node) => (
    typeof node?.getClientRects === "function" && node.getClientRects().length > 0
  );

  const isVerticalScroller = (node) => {
    if (!isVisibleElement(node)) return false;
    try {
      return /^(auto|scroll)$/.test(getComputedStyle(node).overflowY);
    } catch {
      return false;
    }
  };

  const messageHostFor = (root) => {
    const editor = [...root.querySelectorAll(CHAT_EDITOR_SELECTOR)].find(isVisibleElement);
    let branch = editor;
    while (branch && branch !== root) {
      const previous = branch.previousElementSibling;
      // Notion may wrap the history scroller together with a floating control.
      const viewport = isVerticalScroller(previous)
        ? previous
        : [...(previous?.children || [])].find(isVerticalScroller);
      if (viewport) {
        // Sticky portal targets bracket the messages and must not receive zoom.
        return [...viewport.children].find((node) => !node.matches(".sticky-portal-target")) || null;
      }
      branch = branch.parentElement;
    }
    return null;
  };

  const reconcileChatBodies = () => {
    const nextMarkedChatBodies = new Map();
    const roots = [...document.querySelectorAll(CHAT_ROOT_SELECTOR)].filter((root) => (
      !root.parentElement?.closest(CHAT_ROOT_SELECTOR)
    ));
    for (const root of roots) {
      const messageHost = messageHostFor(root);
      if (!messageHost) continue;
      nextMarkedChatBodies.set(
        messageHost,
        root.matches(".chat_sidebar") ? "sidebar" : "full-screen",
      );
    }
    for (const [messageHost, chatType] of nextMarkedChatBodies) {
      if (messageHost.getAttribute(CHAT_BODY_ATTRIBUTE) !== chatType) {
        messageHost.setAttribute(CHAT_BODY_ATTRIBUTE, chatType);
      }
    }
    const staleMarkedChatBodies = new Set([
      ...markedChatBodies,
      ...document.querySelectorAll(CHAT_BODY_SELECTOR),
    ]);
    for (const messageHost of staleMarkedChatBodies) {
      if (!nextMarkedChatBodies.has(messageHost)) {
        messageHost.removeAttribute(CHAT_BODY_ATTRIBUTE);
      }
    }
    markedChatBodies.clear();
    for (const messageHost of nextMarkedChatBodies.keys()) markedChatBodies.add(messageHost);
  };

  const scheduleChatBodyReconcile = () => {
    if (chatBodyFrame !== null) return;
    chatBodyFrame = requestAnimationFrame(() => {
      chatBodyFrame = null;
      reconcileChatBodies();
    });
  };

  const zoomPercentFor = (target) => {
    if (target === "fullScreenChat") return fullScreenChatZoomPercent;
    if (target === "sidebarChat") return sidebarChatZoomPercent;
    return contentZoomPercent;
  };

  const zoomLabelFor = (target) => {
    if (target === "fullScreenChat") return "全屏 AI 对话缩放";
    if (target === "sidebarChat") return "侧栏 AI 对话缩放";
    return "正文缩放";
  };

  const storageKeyFor = (target) => {
    if (target === "fullScreenChat") return FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY;
    if (target === "sidebarChat") return SIDEBAR_CHAT_ZOOM_STORAGE_KEY;
    return CONTENT_ZOOM_STORAGE_KEY;
  };

  const showZoomToast = (target) => {
    let toast = document.getElementById(ZOOM_TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = ZOOM_TOAST_ID;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = `${zoomLabelFor(target)} ${zoomPercentFor(target)}%`;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      document.getElementById(ZOOM_TOAST_ID)?.remove();
      toastTimer = null;
    }, 900);
  };

  const applyZoomPercent = (
    target,
    nextPercent,
    { announce = false, persist = false } = {},
  ) => {
    const zoomPercent = Math.min(
      MAX_ZOOM_PERCENT,
      Math.max(MIN_ZOOM_PERCENT, nextPercent),
    );
    if (target === "fullScreenChat") fullScreenChatZoomPercent = zoomPercent;
    else if (target === "sidebarChat") sidebarChatZoomPercent = zoomPercent;
    else contentZoomPercent = zoomPercent;
    updateZoomStyle();
    if (persist) {
      try {
        window.localStorage.setItem(storageKeyFor(target), String(zoomPercent));
      } catch {}
    }
    if (announce) showZoomToast(target);
  };

  const chatZoomTargetFor = (node) => {
    if (typeof node?.closest !== "function") return null;
    if (node.closest(".chat_sidebar")) return "sidebarChat";
    if (node.closest(".layout-chat")) return "fullScreenChat";
    return null;
  };

  const hasVisibleFullScreenChat = () => (
    [...document.querySelectorAll(".layout-chat")].some((node) => (
      typeof node?.closest === "function"
      && !node.closest(".chat_sidebar")
      && typeof node.getClientRects === "function"
      && node.getClientRects().length > 0
    ))
  );

  const onInteraction = (event) => {
    lastZoomTarget = chatZoomTargetFor(event.target) || "content";
  };

  const shortcutAction = (event) => {
    if (
      event.isComposing
      || !event.ctrlKey
      || !event.shiftKey
      || event.altKey
      || event.metaKey
    ) return null;
    if (["Equal", "NumpadAdd"].includes(event.code)) return "increase";
    if (["Minus", "NumpadSubtract"].includes(event.code)) return "decrease";
    if (["Digit0", "Numpad0"].includes(event.code)) return "reset";
    return null;
  };

  const onKeyDown = (event) => {
    const action = shortcutAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = hasVisibleFullScreenChat()
      ? "fullScreenChat"
      : chatZoomTargetFor(event.target) || lastZoomTarget;
    const currentPercent = zoomPercentFor(target);
    const nextPercent = action === "reset"
      ? DEFAULT_ZOOM_PERCENT
      : currentPercent + (action === "increase" ? ZOOM_STEP_PERCENT : -ZOOM_STEP_PERCENT);
    applyZoomPercent(target, nextPercent, { announce: true, persist: true });
  };

  const onStorage = (event) => {
    if (event.key === CONTENT_ZOOM_STORAGE_KEY) {
      applyZoomPercent("content", parseZoomPercent(event.newValue));
    } else if (event.key === FULL_SCREEN_CHAT_ZOOM_STORAGE_KEY) {
      applyZoomPercent("fullScreenChat", parseZoomPercent(event.newValue));
    } else if (event.key === SIDEBAR_CHAT_ZOOM_STORAGE_KEY) {
      applyZoomPercent("sidebarChat", parseZoomPercent(event.newValue));
    } else if (event.key === null) {
      applyZoomPercent("content", DEFAULT_ZOOM_PERCENT);
      applyZoomPercent("fullScreenChat", DEFAULT_ZOOM_PERCENT);
      applyZoomPercent("sidebarChat", DEFAULT_ZOOM_PERCENT);
    }
  };

  reconcileChatBodies();
  if (typeof MutationObserver === "function" && document.documentElement) {
    chatBodyObserver = new MutationObserver(scheduleChatBodyReconcile);
    chatBodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  updateZoomStyle();
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pointerdown", onInteraction, true);
  window.addEventListener("focusin", onInteraction, true);

  const status = () => ({
    installed: Boolean(
      document.getElementById(STYLE_ID) && document.getElementById(ZOOM_STYLE_ID),
    ),
    version,
    contentZoomPercent,
    fullScreenChatZoomPercent,
    sidebarChatZoomPercent,
    pageContentCount: document.querySelectorAll(".notion-page-content").length,
    collectionItemCount: document.querySelectorAll(".notion-collection-item").length,
    chatCount: document.querySelectorAll(".layout-chat, .chat_sidebar").length,
  });

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pointerdown", onInteraction, true);
    window.removeEventListener("focusin", onInteraction, true);
    chatBodyObserver?.disconnect();
    chatBodyObserver = null;
    if (chatBodyFrame !== null) cancelAnimationFrame(chatBodyFrame);
    chatBodyFrame = null;
    clearChatBodyMarkers();
    if (toastTimer !== null) clearTimeout(toastTimer);
    document.getElementById(ZOOM_TOAST_ID)?.remove();
    document.getElementById(ZOOM_STYLE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    if (window[STATE_KEY]?.version === version) delete window[STATE_KEY];
    return true;
  };

  window[STATE_KEY] = { cleanup, status, version };
  return status();
})("/* Notion 自定义字体配置 */\n@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&family=Oxanium:wght@200..800&family=Pridi:wght@200;300;400;500;600;700&family=Signika:wght@300..700&display=swap');\n\n/* === Notion AI 形象：保留静态外观，禁用装饰动画 === */\n[id^=\"agent-acc-\"] {\n  animation: none !important;\n}\n\n/* === 中文字体映射 === */\n/* 正文：400/500 使用霞鹜文楷 Medium，超过 500 使用霞鹜臻楷 */\n@font-face {\n  font-family: \"NotionRestyleBodyCJK\";\n  src: local(\"LXGWWenKai-Light\");\n  font-weight: 300;\n}\n\n@font-face {\n  font-family: \"NotionRestyleBodyCJK\";\n  src: local(\"LXGWWenKai-Medium\");\n  font-weight: 400;\n}\n\n@font-face {\n  font-family: \"NotionRestyleBodyCJK\";\n  src: local(\"LXGWWenKai-Medium\");\n  font-weight: 500;\n}\n\n@font-face {\n  font-family: \"NotionRestyleBodyCJK\";\n  src: local(\"LXGW ZhenKai GB\"), local(\"LXGWZhenKaiGB\"), local(\"LXGW ZhenKai\"), local(\"LXGWZhenKai-Regular\");\n  font-style: normal;\n  font-weight: 501 900;\n  font-display: swap;\n}\n\n/* 标题：按语义字重使用仓耳云黑 */\n@font-face {\n  font-family: \"NotionRestyleHeadingCJK\";\n  src: local(\"TsangerYunHei-W04\");\n  font-weight: 400;\n}\n\n@font-face {\n  font-family: \"NotionRestyleHeadingCJK\";\n  src: local(\"TsangerYunHei-W05\");\n  font-weight: 500;\n}\n\n@font-face {\n  font-family: \"NotionRestyleHeadingCJK\";\n  src: local(\"TsangerYunHei-W06\");\n  font-weight: 600;\n}\n\n@font-face {\n  font-family: \"NotionRestyleHeadingCJK\";\n  src: local(\"TsangerYunHei-W07\");\n  font-weight: 700;\n}\n\n/* === 右键 Agent 弹层背景与宽度 === */\ndiv.notion-agent-writer-ui {\n  background-color: var(--c-greBacPri) !important;\n  width: calc(100% - 48px) !important;\n  margin-inline: auto !important;\n}\n\n/* === 正文内容字体 === */\ndiv.notion-page-content *,\ndiv.notion-collection-view-body :where(div.notion-page-block:not(.notion-collection-item)) *,\ndiv.notion-collection-item *,\ndiv.layout-chat *,\ndiv.chat_sidebar *,\ndiv.notion-agent-writer-ui :where(div[role=\"group\"].whenContentEditable) * {\n  font-family: \"Oxanium\", \"Pridi\", \"NotionRestyleBodyCJK\", \"Noto Sans SC\", STKaiti, -apple-system,\n    BlinkMacSystemFont, \"Segoe UI\", Helvetica, \"Apple Color Emoji\",\n    Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\" !important;\n  font-weight: 500;\n  line-height: 1.8em !important;\n}\n\n/* === 侧边栏字体 === */\n/* 英文/数字沿用正文的 Oxanium→Pridi 字体栈；中文字符不在该栈内，继续使用系统默认中文字体 */\n:where(.notion-sidebar-container) * {\n  font-family: \"Oxanium\", \"Pridi\", ui-sans-serif, -apple-system, \"system-ui\",\n    \"Segoe UI Variable Display\", \"Segoe UI\", Helvetica, Arial, sans-serif !important;\n}\n\n/* Feed popup 的内容块使用普通正文的 16px 基准字号 */\ndiv.notion-peek-renderer div.notion-collection-view-body\n  :where(div.notion-page-block:not(.notion-collection-item):not(div.notion-page-block div.notion-page-block))\n  :where(div.notion-selectable:not(.notion-page-block)) {\n  font-size: 16px !important;\n}\n\n/* 右键 Agent 生成内容比普通正文稍小，但继续跟随正文缩放 */\ndiv.notion-agent-writer-ui :where(div[role=\"group\"].whenContentEditable)\n  :where(div.notion-selectable:not(.notion-page-block)) {\n  font-size: 13px !important;\n}\n\n/* === 分隔符：保留整行交互区域，只缩短并居中可见横线 === */\ndiv.notion-divider-block [role=\"separator\"] {\n  width: 100px !important;\n  height: 2px !important;\n  margin-inline: auto !important;\n}\n\n/* === 页面标题字体 === */\nh1[aria-roledescription=\"page title\"],\nh1[aria-roledescription=\"page title\"] * {\n  font-family: \"Signika\", \"NotionRestyleHeadingCJK\", \"Noto Sans SC\", \"PingFang SC\", sans-serif !important;\n  font-weight: 700 !important;\n}\n\n/* === 标题字体 === */\n/* 仅将真实标题块设为标题样式，避免 Feed 预览中的正文被整体加粗 */\ndiv.notion-header-block span,\ndiv.notion-header-block div,\ndiv.notion-header-block h1,\ndiv.notion-header-block h2,\ndiv.notion-header-block h3,\ndiv.notion-sub_header-block span,\ndiv.notion-sub_header-block div,\ndiv.notion-sub_header-block h1,\ndiv.notion-sub_header-block h2,\ndiv.notion-sub_header-block h3,\ndiv.notion-sub_sub_header-block span,\ndiv.notion-sub_sub_header-block div,\ndiv.notion-sub_sub_header-block h1,\ndiv.notion-sub_sub_header-block h2,\ndiv.notion-sub_sub_header-block h3 {\n  font-family: \"Pridi1\", \"Signika\", \"Oswald\", \"Space Grotesk\", \"NotionRestyleHeadingCJK\", \"Noto Sans SC\", \"PingFang SC\" !important;\n  font-weight: 500 !important;\n}\n\n/* 页面卡片标题使用标题字体，但保留 Notion 自己设置的标题字重 */\ndiv.notion-page-block:not(.notion-collection-item) a > div[role=\"button\"],\ndiv.notion-page-block:not(.notion-collection-item) a > div[role=\"button\"] * {\n  font-family: \"Pridi1\", \"Signika\", \"Oswald\", \"Space Grotesk\", \"NotionRestyleHeadingCJK\", \"Noto Sans SC\", \"PingFang SC\" !important;\n}\n\n/* === 数据库卡片字体 === */\n/* notion-page-block 也用于卡片标题；在卡片内恢复正文的常规字重 */\ndiv.notion-collection-item.notion-collection-item,\ndiv.notion-collection-item.notion-collection-item * {\n  font-family: \"Oxanium\", \"Pridi\", \"NotionRestyleBodyCJK\", \"Noto Sans SC\", STKaiti, -apple-system,\n    BlinkMacSystemFont, \"Segoe UI\", Helvetica, \"Apple Color Emoji\",\n    Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\" !important;\n  font-weight: 400 !important;\n}\n\n/* 卡片内的页面图标保留 Notion 的紧凑行高，避免 emoji 被正文行高压到文字下方 */\ndiv.notion-collection-item .notion-record-icon,\ndiv.notion-collection-item .notion-record-icon * {\n  line-height: 1 !important;\n}\n\n/* === 数据库属性字体 === */\n/* 页面标题容器也包住侧栏属性；普通属性使用正文样式，保留显式 font-weight */\ndiv.notion-page-block [role=\"row\"] [role=\"cell\"] div,\ndiv.notion-page-block [role=\"row\"] [role=\"cell\"] span {\n  font-family: \"Oxanium\", \"Pridi\", \"NotionRestyleBodyCJK\", \"Noto Sans SC\", STKaiti, -apple-system,\n    BlinkMacSystemFont, \"Segoe UI\", Helvetica, \"Apple Color Emoji\",\n    Arial, sans-serif, \"Segoe UI Emoji\", \"Segoe UI Symbol\" !important;\n}\n\ndiv.notion-page-block [role=\"row\"] [role=\"cell\"] div:not([style*=\"font-weight\"]),\ndiv.notion-page-block [role=\"row\"] [role=\"cell\"] span:not([style*=\"font-weight\"]) {\n  font-weight: 400 !important;\n}\n\n/* === 代码块字体（启用连字） === */\ndiv.notion-code-block [data-content-editable-leaf],\ndiv.notion-code-block [data-content-editable-leaf] * {\n  font-family: \"Cascadia Code NF\", Consolas, \"NotionRestyleBodyCJK\", \"Noto Sans SC\", monospace !important;\n  font-feature-settings: \"liga\" 1, \"calt\" 1;\n}\n", "3fda2e11f6e4a5e2ee33")
;

  if (!window.__NOTION_RESTYLE_MENU_REGISTERED__) {
    GM_registerMenuCommand("Notion Restyle：暂时停用当前页（刷新恢复）", () => {
      window.__NOTION_RESTYLE_STATE__?.cleanup?.();
    });
    window.__NOTION_RESTYLE_MENU_REGISTERED__ = true;
  }
})();
