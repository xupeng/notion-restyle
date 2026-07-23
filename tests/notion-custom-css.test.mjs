import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const css = await fs.readFile(
  new URL("../assets/notion-custom.css", import.meta.url),
  "utf8",
);

test("disables AI accessory animation without suppressing loading indicators", () => {
  const accessoryRule = css.match(/\[id\^=["']agent-acc-["']\]\s*\{([^}]*)\}/);

  assert.ok(accessoryRule, "missing the shared Notion AI accessory selector");
  assert.match(
    accessoryRule[1],
    /(?:^|;)\s*animation:\s*none\s*!important\s*;?/,
  );
  assert.doesNotMatch(css, /\[role=["']status["']\]/);
  assert.doesNotMatch(css, /animation(?:-name)?\s*:[^;}]*\bspin\b/i);
  assert.doesNotMatch(
    css,
    /(?:^|})\s*\*\s*\{[^}]*\banimation\s*:\s*none\b/im,
  );
});
