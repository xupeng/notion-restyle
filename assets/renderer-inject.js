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
    const zoomRule = (selector, percent) => (
      percent === DEFAULT_ZOOM_PERCENT
        ? ""
        : `
${selector} {
  zoom: ${String(percent / 100)} !important;
}
`
    );
    const chatZoomCss = [
      zoomRule(FULL_SCREEN_CHAT_BODY_SELECTOR, fullScreenChatZoomPercent),
      zoomRule(SIDEBAR_CHAT_BODY_SELECTOR, sidebarChatZoomPercent),
    ].join("");
    zoomStyle.textContent = `
div.notion-page-content {
  zoom: ${contentFactor} !important;
}
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
      const viewport = branch.previousElementSibling;
      if (isVerticalScroller(viewport)) return viewport.firstElementChild;
      branch = branch.parentElement;
    }
    return null;
  };

  const reconcileChatBodies = () => {
    clearChatBodyMarkers();
    const roots = [...document.querySelectorAll(CHAT_ROOT_SELECTOR)].filter((root) => (
      !root.parentElement?.closest(CHAT_ROOT_SELECTOR)
    ));
    for (const root of roots) {
      const messageHost = messageHostFor(root);
      if (!messageHost) continue;
      messageHost.setAttribute(
        CHAT_BODY_ATTRIBUTE,
        root.matches(".chat_sidebar") ? "sidebar" : "full-screen",
      );
      markedChatBodies.add(messageHost);
    }
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
})(__NOTION_RESTYLE_CSS_JSON__, __NOTION_RESTYLE_VERSION_JSON__)
