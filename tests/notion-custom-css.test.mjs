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
      ["501 900", "LXGW ZhenKai GB"],
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
        new RegExp(`src:\\s*local\\(["']${localName}["']\\)(?:\\s*,\\s*local\\([^)]*\\))*\\s*;`),
      );
    }
  }

  const bodyRules = fontFaceRulesFor("NotionRestyleBodyCJK").join("\n");
  assert.doesNotMatch(bodyRules, /TsangerYunHei/);
  assert.doesNotMatch(bodyRules, /font-weight:\s*(?:600|700)\s*;/);
  assert.doesNotMatch(bodyRules, /size-adjust\s*:/);
  assert.match(
    bodyRules,
    /src:\s*local\("LXGW ZhenKai GB"\),\s*local\("LXGWZhenKaiGB"\),\s*local\("LXGW ZhenKai"\),\s*local\("LXGWZhenKai-Regular"\)/,
  );
  assert.doesNotMatch(css, /-webkit-text-stroke\s*:/);

  assert.match(
    css,
    /font-family:\s*"Oxanium",\s*"Pridi",\s*"NotionRestyleBodyCJK",\s*"Noto Sans SC"/,
  );
  assert.match(css, /family=Oxanium:wght@200\.\.800/);
  assert.doesNotMatch(css, /\bCaecilia LT Std\b/);
  assert.match(
    css,
    /font-family:\s*"Pridi1",\s*"Signika",\s*"Oswald",\s*"Space Grotesk",\s*"NotionRestyleHeadingCJK",\s*"Noto Sans SC"/,
  );
  assert.doesNotMatch(css, /\bXinFang\b/);
  assert.doesNotMatch(css, /\bYunHei\b/);
  assert.doesNotMatch(css, /local\(["']LXGW WenKai Screen["']\)/);
});

test("styles the Notion AI home screen that has no chat layout classes", () => {
  const homeRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => match[1].includes("data-notion-chat-input-container"));

  assert.ok(homeRule, "missing the Notion AI home font rule");
  assert.match(
    homeRule[1],
    /:where\(\s*div:has\(\[data-notion-chat-input-container\]\):not\(\s*:has\(\.layout-chat,\s*\.chat_sidebar,\s*\.notion-sidebar-container\)\s*\)\s*\)\s*\*/,
  );
  assert.match(
    homeRule[2],
    /font-family:\s*"Oxanium",\s*"Pridi",\s*"NotionRestyleBodyCJK",\s*"Noto Sans SC"/,
  );
  assert.match(homeRule[2], /line-height:\s*1\.8em\s*!important\s*;/);
});

test("applies the custom Latin font to the sidebar and keeps CJK fonts untouched", () => {
  const sidebarRule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((match) => /:where\(\s*\.notion-sidebar-container\s*\)/.test(match[1]));

  assert.ok(sidebarRule, "missing the sidebar font rule");
  assert.match(
    sidebarRule[1],
    /:where\(\s*\.notion-sidebar-container\s*\)\s*\*/,
  );
  assert.match(
    sidebarRule[2],
    /font-family:\s*"Oxanium",\s*"Pridi",\s*ui-sans-serif/,
  );
  assert.doesNotMatch(
    sidebarRule[2],
    /NotionRestyle(?:Body|Heading)CJK|Noto Sans SC|STKaiti|TsangerYunHei|LXGWWenKai/,
  );
  assert.doesNotMatch(
    sidebarRule[2],
    /(?:font-weight|font-size|line-height|letter-spacing)\s*:/,
  );
});

test("keeps collection record icons vertically aligned with card text", () => {
  const iconRule = css.match(
    /div\.notion-collection-item \.notion-record-icon,\s*div\.notion-collection-item \.notion-record-icon \*\s*\{([^}]*)\}/,
  );

  assert.ok(iconRule, "missing the scoped collection record icon reset");
  assert.match(iconRule[1], /line-height:\s*1\s*!important\s*;/);
  assert.doesNotMatch(iconRule[1], /(?:position|transform|margin|top)\s*:/);
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
