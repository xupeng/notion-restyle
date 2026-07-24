import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const css = await fs.readFile(
  new URL("../assets/notion-custom.css", import.meta.url),
  "utf8",
);

function fontFaceRulesFor(fontFamily) {
  const escapedFamily = fontFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const familyDeclaration = new RegExp(
    `font-family:\\s*["']${escapedFamily}["']\\s*;`,
  );

  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .filter((rule) => familyDeclaration.test(rule));
}

test("maps role-based CJK font families to the intended local sources", () => {
  const expectedFamilies = new Map([
    ["NotionRestyleBodyCJK", new Map([
      [300, "LXGWWenKai-Light"],
      [400, "LXGWWenKai-Medium"],
      [500, "LXGWWenKai-Medium"],
    ])],
    ["NotionRestyleHeadingCJK", new Map([
      [400, "TsangerYunHei-W04"],
      [500, "TsangerYunHei-W05"],
      [600, "TsangerYunHei-W06"],
      [700, "TsangerYunHei-W07"],
    ])],
  ]);

  for (const [fontFamily, expectedWeights] of expectedFamilies) {
    const rules = fontFaceRulesFor(fontFamily);
    assert.equal(
      rules.length,
      expectedWeights.size,
      `${fontFamily} must declare exactly the expected weights`,
    );

    for (const [weight, localName] of expectedWeights) {
      const rule = rules.find((candidate) => (
        new RegExp(`font-weight:\\s*${weight}\\s*;`).test(candidate)
      ));
      assert.ok(rule, `${fontFamily} is missing font-weight ${weight}`);
      assert.match(
        rule,
        new RegExp(`src:\\s*local\\(["']${localName}["']\\)\\s*;`),
      );
    }
  }

  const bodyRules = fontFaceRulesFor("NotionRestyleBodyCJK").join("\n");
  assert.doesNotMatch(bodyRules, /TsangerYunHei/);
  assert.doesNotMatch(bodyRules, /font-weight:\s*(?:600|700)\s*;/);
  assert.doesNotMatch(bodyRules, /size-adjust\s*:/);

  assert.match(
    css,
    /font-family:\s*"Caecilia LT Std",\s*"Pridi",\s*"NotionRestyleBodyCJK",\s*"Noto Sans SC"/,
  );
  assert.match(
    css,
    /font-family:\s*"Pridi1",\s*"Signika",\s*"Oswald",\s*"Space Grotesk",\s*"NotionRestyleHeadingCJK",\s*"Noto Sans SC"/,
  );
  assert.doesNotMatch(css, /\bXinFang\b/);
  assert.doesNotMatch(css, /\bYunHei\b/);
  assert.doesNotMatch(css, /local\(["']LXGW WenKai Screen["']\)/);
});

test("enhances inline body bold without changing layout metrics", () => {
  const boldRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => (
      match[1].includes('span:is([style*="font-weight:600"], [style*="font-weight: 600"])')
    ));

  assert.ok(boldRule, "missing the scoped inline bold enhancement");
  assert.match(boldRule[1], /div\.notion-page-content/);
  assert.match(boldRule[1], /div\.notion-collection-view-body/);
  assert.match(boldRule[1], /div\.notion-agent-writer-ui/);
  assert.match(boldRule[1], /:not\(\.notion-header-block\)/);
  assert.match(boldRule[1], /:not\(\.notion-sub_header-block\)/);
  assert.match(boldRule[1], /:not\(\.notion-sub_sub_header-block\)/);
  assert.match(boldRule[1], /:not\(div\.notion-collection-item \*\)/);
  assert.match(
    boldRule[2],
    /-webkit-text-stroke:\s*0\.25px\s+currentColor\s*;/,
  );
  assert.doesNotMatch(
    boldRule[2],
    /(?:font-size|line-height|letter-spacing|font-weight|transform|zoom)\s*:/,
  );
});

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
