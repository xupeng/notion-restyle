((cssText, version) => {
  const STATE_KEY = "__NOTION_RESTYLE_STATE__";
  const STYLE_ID = "notion-restyle-style";

  window[STATE_KEY]?.cleanup?.();

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== cssText) style.textContent = cssText;
  style.dataset.notionRestyleVersion = version;

  const status = () => ({
    installed: Boolean(document.getElementById(STYLE_ID)),
    version,
    pageContentCount: document.querySelectorAll(".notion-page-content").length,
    collectionItemCount: document.querySelectorAll(".notion-collection-item").length,
    chatCount: document.querySelectorAll(".layout-chat, .chat_sidebar").length,
  });

  const cleanup = () => {
    document.getElementById(STYLE_ID)?.remove();
    if (window[STATE_KEY]?.version === version) delete window[STATE_KEY];
    return true;
  };

  window[STATE_KEY] = { cleanup, status, version };
  return status();
})(__NOTION_RESTYLE_CSS_JSON__, __NOTION_RESTYLE_VERSION_JSON__)
