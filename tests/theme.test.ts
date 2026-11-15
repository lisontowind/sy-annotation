import { test } from "node:test";
import assert from "node:assert/strict";
import { appearanceOf, readColorEnvironment, resolveValue, visualSignature } from "../src/appearance";
import { browserColor, colorPair, THEME_MODE } from "../src/theme-colors";
import { ToolManager } from "../src/tool-manager";
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

test("theme detection and stored configuration retain authored colors", () => {
  const dom = installDOM();
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  const host = { config: { appearance: { mode: 1 } } };
  Object.assign(window, { siyuan: host });
  assert.equal(readColorEnvironment()[THEME_MODE], "dark");
  const config = loadToolConfig({ version: 1, tools: [{ ...STYLES[0], styles: { color: "#123" } }], selectedId: "yellow" });
  assert.equal(config.version, 1); assert.equal(config.tools[0].styles.color, "#123");
});

test("a new combination saves sampled theme colors and simultaneous underline and strike-through without changing existing tools", async () => {
  const dom = installDOM();
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: () => true } });
  const sampled = { marks: ["u", "s", "strong"] as const, styles: {
    color: "light-dark(#123, #def)", "background-color": "var(--b3-font-background12)",
    "text-decoration-line": "underline line-through", "text-decoration-style": "wavy",
    "text-decoration-color": "var(--b3-font-color1)", "font-size": "20px",
    "text-shadow": "1px 1px var(--b3-theme-surface-lighter)",
    "-webkit-text-stroke": "0.2px var(--b3-theme-on-background)", "-webkit-text-fill-color": "transparent",
  } };
  const style = { ...sampled, marks: [...sampled.marks] };
  const config = loadToolConfig(null), before = JSON.stringify(config.tools);
  let saved = config.tools;
  const manager = new ToolManager(config.tools, async tools => { saved = tools; }, undefined, true, undefined, style);
  manager.element.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  assert.equal(saved.length, config.tools.length + 1);
  const created = saved.at(-1)!;
  assert.equal(created.label, "新组合样式");
  assert.equal(visualSignature(created), visualSignature(style));
  assert.equal(created.styles["background-color"], "var(--b3-font-background12)");
  assert.equal(created.styles["text-decoration-color"], "var(--b3-font-color1)");
  assert.equal(JSON.stringify(config.tools), before);
  manager.close();
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
