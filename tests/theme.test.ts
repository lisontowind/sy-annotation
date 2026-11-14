import { test } from "node:test";
import assert from "node:assert/strict";
import { appearanceOf, readColorEnvironment, resolveValue, visualSignature } from "../src/appearance";
import { browserColor, colorPair, THEME_MODE } from "../src/theme-colors";
import { inheritCurrentStyle } from "../src/tool-manager";
import { loadToolConfig, parseAnnotations, STYLES } from "../src/model";
import { emptyQuery, QueryEngine } from "../src/filters";
import { repairAppearance, repairBlock, repairCandidates, repairTools } from "../src/color-repair";
import { installDOM, paragraph } from "./dom";

test("theme expressions resolve nested variables, RGB commas, fallbacks and legacy pairs without flattening storage", () => {
  const pair = "light-dark(rgb(17, 34, 51), rgba(221, 238, 255, 0.8))";
  assert.deepEqual(colorPair(pair), ["rgb(17, 34, 51)", "rgba(221, 238, 255, 0.8)"]);
  assert.equal(resolveValue(pair, { [THEME_MODE]: "dark" }), "rgba(221,238,255,0.8)");
  assert.equal(resolveValue("var(--a, var(--b, #123))", { [THEME_MODE]: "light" }), "rgb(17,34,51)");
  assert.equal(resolveValue("var(--a)", { "--a": "var(--b)", "--b": pair, [THEME_MODE]: "light" }), "rgb(17,34,51)");
  const legacy = "var(--b3-legacy-light-color, rgb(17, 34, 51)) var(--b3-legacy-dark-color, #ddeeff)";
  assert.equal(resolveValue(legacy, { [THEME_MODE]: "dark" }), "rgb(221,238,255)");
  assert.equal(resolveValue(legacy), "light-dark(rgb(17,34,51), rgb(221,238,255))");
  const previous = globalThis.CSS;
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => false } });
  assert.match(browserColor(pair), /--b3-legacy-light-color/);
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: previous });
});

test("inheritance retains native palette, dual colors, shadow and hollow expressions", async () => {
  const dom = installDOM();
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  const host = { storage: { "local-fontstyles": ["style1\u200bvar(--b3-font-background12)\u200blight-dark(#123, #def)"] }, config: { appearance: { mode: 1 } } };
  Object.assign(window, { siyuan: host });
  const style = await inheritCurrentStyle();
  assert.equal(style.styles["background-color"], "var(--b3-font-background12)");
  assert.equal(style.styles.color, "light-dark(#123, #def)");
  assert.equal(readColorEnvironment()[THEME_MODE], "dark");
  for (const type of ["style2", "style4"]) {
    host.storage["local-fontstyles"] = [type];
    assert.ok(Object.values((await inheritCurrentStyle()).styles).some(value => value.includes("var(--b3-theme-")));
  }
  const config = loadToolConfig({ version: 1, tools: [{ ...STYLES[0], styles: { color: "#123" } }], selectedId: "yellow" });
  assert.equal(config.version, 1); assert.equal(config.tools[0].styles.color, "#123");
});

test("color and complete-style filters keep authored pairs across themes, including worker environments", () => {
  const annotation = parseAnnotations(paragraph("p", '<span data-type="text" style="color:light-dark(#123, #def);background-color:var(--b3-font-background12)">配色</span>')).annotations[0];
  const appearance = appearanceOf(annotation);
  const signature = visualSignature(appearance);
  for (const theme of ["light", "dark"]) {
    const env = { [THEME_MODE]: theme, "--b3-font-background12": theme === "dark" ? "#654" : "#fed" };
    const engine = new QueryEngine(STYLES, JSON.parse(JSON.stringify(env)));
    const query = emptyQuery(); query.rule = { kind: "condition", field: "signature", value: signature, exclude: false };
    assert.equal(engine.select([annotation], query).length, 1);
    query.rule = { kind: "condition", field: "color", value: appearance.styles.color, exclude: false };
    assert.equal(engine.select([annotation], query).length, 1);
    query.rule = { kind: "condition", field: "background-color", value: "var(--b3-font-background12)", exclude: false };
    assert.equal(engine.select([annotation], query).length, 1);
  }
});

test("repair changes same-looking fixed colors into theme expressions while preserving other formatting and semantics", () => {
  installDOM();
  const html = paragraph("p", '<span data-type="a strong text" data-href="https://example.test" style="color:#112233;font-weight:700;text-decoration-style:wavy"><span data-type="block-ref" data-id="ref">链接引用</span></span><span data-type="text" style="color:#445566">保留</span>');
  const mappings = [{ property: "color" as const, from: "rgb(17,34,51)", to: "var(--b3-font-color1)" }];
  const candidates = repairCandidates(parseAnnotations(html).annotations.map(appearanceOf));
  assert.equal(candidates.length, 2); assert.equal(candidates[0].count, 1);
  const block = repairBlock(html, mappings, STYLES);
  assert.equal(block.count, 1); assert.notEqual(block.before, block.after);
  const root = document.createElement("div"); root.innerHTML = block.after;
  assert.equal(root.querySelector('[data-href]')?.getAttribute("data-href"), "https://example.test");
  assert.equal(root.querySelector('[data-id]')?.getAttribute("data-id"), "ref");
  assert.equal(root.querySelector<HTMLElement>('[data-href]')!.style.fontWeight, "700");
  assert.equal(root.querySelector<HTMLElement>('[data-href]')!.style.textDecorationStyle, "wavy");
  assert.match(block.after, /var\(--b3-font-color1\)/); assert.match(block.after, /#445566/);
  assert.equal(repairBlock(block.after, mappings, STYLES).count, 0, "repair is idempotent");
  const tools = [{ ...STYLES[0], styles: { color: "#112233", "font-weight": "bold" } }];
  const repaired = repairTools(tools, mappings);
  assert.equal(tools[0].styles.color, "#112233");
  assert.equal(repaired[0].styles.color, "var(--b3-font-color1)");
  assert.equal(repaired[0].styles["font-weight"], "bold");
  assert.equal(repairCandidates(repaired).length, 0);
  assert.equal(repairAppearance({ marks: [], styles: { color: "#112233" } }, [
    { property: "color", from: "#112233", to: "#445566" }, { property: "color", from: "#445566", to: "#ffffff" },
  ]).styles.color, "#445566", "mappings use original values rather than cascading");
});
