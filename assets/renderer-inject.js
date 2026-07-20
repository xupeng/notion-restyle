((cssText, version) => {
  const STATE_KEY = "__NOTION_RESTYLE_STATE__";
  const STYLE_ID = "notion-restyle-style";
  const ZOOM_STYLE_ID = "notion-restyle-content-zoom-style";
  const ZOOM_TOAST_ID = "notion-restyle-content-zoom-toast";
  const ZOOM_STORAGE_KEY = "notion-restyle.contentZoomPercent.v1";
  const DEFAULT_ZOOM_PERCENT = 100;
  const MIN_ZOOM_PERCENT = 60;
  const MAX_ZOOM_PERCENT = 160;
  const ZOOM_STEP_PERCENT = 10;

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

  const readZoomPercent = () => {
    try {
      return parseZoomPercent(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    } catch {
      return DEFAULT_ZOOM_PERCENT;
    }
  };

  let contentZoomPercent = readZoomPercent();
  let toastTimer = null;
  let zoomStyle = document.getElementById(ZOOM_STYLE_ID);
  if (!zoomStyle) {
    zoomStyle = document.createElement("style");
    zoomStyle.id = ZOOM_STYLE_ID;
    (document.head || document.documentElement).appendChild(zoomStyle);
  }
  zoomStyle.dataset.notionRestyleVersion = version;

  const updateZoomStyle = () => {
    const factor = String(contentZoomPercent / 100);
    zoomStyle.textContent = `
div.notion-page-content {
  zoom: ${factor} !important;
}

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

  const showZoomToast = () => {
    let toast = document.getElementById(ZOOM_TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = ZOOM_TOAST_ID;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = `正文缩放 ${contentZoomPercent}%`;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      document.getElementById(ZOOM_TOAST_ID)?.remove();
      toastTimer = null;
    }, 900);
  };

  const applyZoomPercent = (nextPercent, { announce = false, persist = false } = {}) => {
    contentZoomPercent = Math.min(
      MAX_ZOOM_PERCENT,
      Math.max(MIN_ZOOM_PERCENT, nextPercent),
    );
    updateZoomStyle();
    if (persist) {
      try { window.localStorage.setItem(ZOOM_STORAGE_KEY, String(contentZoomPercent)); } catch {}
    }
    if (announce) showZoomToast();
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
    const nextPercent = action === "reset"
      ? DEFAULT_ZOOM_PERCENT
      : contentZoomPercent + (action === "increase" ? ZOOM_STEP_PERCENT : -ZOOM_STEP_PERCENT);
    applyZoomPercent(nextPercent, { announce: true, persist: true });
  };

  const onStorage = (event) => {
    if (event.key !== ZOOM_STORAGE_KEY && event.key !== null) return;
    applyZoomPercent(parseZoomPercent(event.newValue));
  };

  updateZoomStyle();
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("storage", onStorage);

  const status = () => ({
    installed: Boolean(
      document.getElementById(STYLE_ID) && document.getElementById(ZOOM_STYLE_ID),
    ),
    version,
    contentZoomPercent,
    pageContentCount: document.querySelectorAll(".notion-page-content").length,
    collectionItemCount: document.querySelectorAll(".notion-collection-item").length,
    chatCount: document.querySelectorAll(".layout-chat, .chat_sidebar").length,
  });

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("storage", onStorage);
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
