import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const CSS_TOKEN = "__NOTION_RESTYLE_CSS_JSON__";
const VERSION_TOKEN = "__NOTION_RESTYLE_VERSION_JSON__";

export function buildRendererPayload(css, template) {
  for (const token of [CSS_TOKEN, VERSION_TOKEN]) {
    if (template.split(token).length !== 2) {
      throw new Error(`Renderer template must contain exactly one ${token}`);
    }
  }
  const revision = createHash("sha256").update(css).update(template).digest("hex").slice(0, 20);
  const replacements = {
    [CSS_TOKEN]: JSON.stringify(css),
    [VERSION_TOKEN]: JSON.stringify(revision),
  };
  return {
    // A single callback-based pass preserves dollar sequences and token-like CSS text.
    payload: template.replace(
      /__NOTION_RESTYLE_(?:CSS|VERSION)_JSON__/g,
      (token) => replacements[token],
    ),
    revision,
  };
}

export async function readRendererPayload() {
  const [css, template] = await Promise.all([
    fs.readFile(new URL("../assets/notion-custom.css", import.meta.url), "utf8"),
    fs.readFile(new URL("../assets/renderer-inject.js", import.meta.url), "utf8"),
  ]);
  return buildRendererPayload(css, template);
}
