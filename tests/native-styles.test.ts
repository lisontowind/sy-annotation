import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNativeTools, emptyNativeStyles, matchesNativeStyle, nativeRef, NativeStyleLibrary, normalizeNativeStyles } from "../src/native-styles";
import { ColorField } from "../src/color-field";
import { loadToolConfig, parseAnnotations } from "../src/model";
import { appearanceOf, visualSignature } from "../src/appearance";
import { QueryEngine, emptyQuery } from "../src/filters";
import { replaceBlock } from "../src/replacement";
import { installDOM, paragraph } from "./dom";

const first = "20261115090000-customa", second = "20261115090001-customb";
const sample = () => normalizeNativeStyles({ version: 2, styles: [
  { id: first, name: "证据", light: { color: "#112233" }, dark: { color: "#ddeeff" } },
  { id: second, name: "相同颜色", hidden: true, light: { color: "#112233" }, dark: { color: "#ddeeff" } },
], order: { color: [first, "3", first, "missing"] }, builtin: { hidden: { color: [2] }, styles: [{ id: "error", light: { color: "#334455" }, dark: { color: "#ccbbaa" } }] } });

test("native palette honors custom names, ordering, hiding and both modes while retaining references", () => {
  const data = sample(), original = JSON.stringify(data);
  const tools = buildNativeTools(data);
  assert.equal(tools.find(tool => tool.nativeRef?.group === "color" && tool.nativeRef.key !== "default")!.nativeRef!.key, first);
  assert.equal(tools.find(tool => tool.nativeRef?.key === second)!.hidden, true);
  assert.equal(tools.find(tool => tool.id === "native:color:2")!.hidden, true);
  assert.equal(tools.find(tool => tool.nativeRef?.key === first)!.label, "证据");
  assert.match(buildNativeTools(data, "dark").find(tool => tool.nativeRef?.key === first)!.styles.color, /--b3-inline-style-.*-color, #ddeeff/);
  assert.equal(JSON.stringify(data), original);
  const unicode = structuredClone(data); unicode.styles[0].name = "📚".repeat(64);
  assert.equal(normalizeNativeStyles(unicode).styles[0].name, unicode.styles[0].name);
  const moved = structuredClone(data);
  moved.styles[0].light = { backgroundColor: "#112233" }; moved.styles[0].dark = { backgroundColor: "#ddeeff" };
  assert.equal(buildNativeTools(normalizeNativeStyles(moved)).find(tool => tool.nativeRef?.key === first)!.id, `native:custom:${first}`, "changing a native category preserves identity");
  assert.equal(normalizeNativeStyles({ version: 1, styles: [] }).order.color.length, 13);
  const loaded = loadToolConfig({ version: 1, tools: [], selectedId: `native:custom:${first}` });
  assert.equal(loaded.selectedId, `native:custom:${first}`); assert.deepEqual(loaded.tools, []);
});

test("native color fields preserve old values until an explicit choice and do not offer global color editing", () => {
  installDOM(); let changes = 0;
  const field = new ColorField("color", "#112233", () => changes++, "文字颜色");
  assert.equal(field.value, "#112233"); assert.equal(changes, 0); assert.equal(field.element.querySelector("input"), null);
  field.element.querySelector<HTMLButtonElement>('[data-tool-id="native:color:3"]')!.click();
  assert.equal(field.value, "var(--b3-font-color3)"); assert.equal(changes, 1);
  field.element.querySelector<HTMLButtonElement>('[data-tool-id="native:color:default"]')!.click();
  assert.equal(field.value, ""); assert.equal(field.valid(), true); assert.equal(changes, 2); field.destroy();
  const required = new ColorField("color", "#112233", () => {}, "文字颜色", false);
  assert.equal(required.element.querySelector('[data-tool-id="native:color:default"]'), null); required.destroy();
});

test("native defaults restore colors without indexing plain text or swallowing other styles", () => {
  const tools = buildNativeTools(emptyNativeStyles());
  for (const group of ["style1", "color", "backgroundColor"]) {
    const first = tools.find(tool => tool.nativeRef?.group === group)!;
    assert.equal(first.id, `native:${group}:default`); assert.deepEqual(first.styles, {});
    assert.ok(nativeRef(first.id));
  }
  const annotations = parseAnnotations(paragraph("plain", "普通文字") + paragraph("line", '<span data-type="u">默认配色的下划线</span>') +
    paragraph("color", '<span data-type="text" style="color:#123456">旧文字色</span>') +
    paragraph("background", '<span data-type="text" style="background-color:#123456">旧背景色</span>'), tools).annotations;
  assert.equal(annotations.length, 3, "default choices never turn unmarked text into annotations");
  const engine = new QueryEngine(tools), query = emptyQuery();
  query.quick = "native:style1:default"; assert.deepEqual(engine.select(annotations, query).map(a => a.blockId), ["line"]);
  query.quick = "native:color:default"; assert.deepEqual(engine.select(annotations, query).map(a => a.blockId), ["line", "background"]);
  query.quick = "native:backgroundColor:default"; assert.deepEqual(engine.select(annotations, query).map(a => a.blockId), ["line", "color"]);
  query.quick = "other"; assert.equal(engine.select(annotations, query).length, 3);
});

test("replacing with the default style removes authored colors and preserves link identity", () => {
  installDOM();
  const target = buildNativeTools(emptyNativeStyles()).find(tool => tool.id === "native:style1:default")!;
  const html = paragraph("p", '<span data-type="a strong u text" data-href="https://example.test" style="color:#123456;background-color:#fedcba">恢复配色</span>');
  const annotations = parseAnnotations(html).annotations;
  for (const mode of ["replace", "preserve"] as const) {
    const result = replaceBlock(html, annotations, target, mode, {}, [target]);
    const template = document.createElement("template"); template.innerHTML = result.after;
    const link = template.content.querySelector<HTMLElement>('[data-href="https://example.test"]')!;
    assert.equal(result.count, 1); assert.equal(link.style.color, ""); assert.equal(link.style.backgroundColor, "");
    assert.equal(link.textContent, "恢复配色");
    assert.equal(link.dataset.type?.includes("strong"), mode === "preserve");
  }
});

test("native search distinguishes same-color styles and fixed colors, tolerates fallback changes and extra formatting", () => {
  const html = paragraph("a", `<span data-type="text" style="color:var(--b3-inline-style-${first}-color, #123456)">证据一</span>`) +
    paragraph("b", `<span data-type="u text" style="color:var(--b3-inline-style-${first}-color, #654321)">证据二</span>`) +
    paragraph("c", `<span data-type="text" style="color:var(--b3-inline-style-${second}-color, #112233)">其他样式</span>`) +
    paragraph("d", '<span data-type="text" style="color:#112233">固定颜色</span>');
  const annotations = parseAnnotations(html).annotations;
  const engine = new QueryEngine(buildNativeTools(sample()), { [`--b3-inline-style-${first}-color`]: "#112233", [`--b3-inline-style-${second}-color`]: "#112233" });
  const query = emptyQuery(); query.quick = `native:custom:${first}`;
  assert.deepEqual(engine.select(annotations, query).map(a => a.blockId), ["a", "b"]);
  query.quick = "all"; query.rule = { kind: "condition", field: "nativeStyle", value: `native:custom:${first}`, exclude: false };
  assert.equal(engine.select(annotations, query).length, 2);
  query.search = "证据二"; assert.equal(engine.select(annotations, query).length, 1);
  query.search = ""; query.rule = { kind: "condition", field: "color", value: "#112233", exclude: false };
  assert.equal(engine.select(annotations, query).length, 4);
  assert.ok(matchesNativeStyle({ color: "var(--b3-inline-builtin-error-color, var(--b3-card-error-color))", "background-color": "var(--b3-card-error-background)" }, nativeRef("native:style1:error")!));
});

test("same-looking replacement changes native association and is idempotent after serialization", () => {
  installDOM();
  const tool = buildNativeTools(sample()).find(tool => tool.id === `native:custom:${first}`)!;
  const env = { [`--b3-inline-style-${first}-color`]: "#112233" };
  const html = paragraph("p", '<span data-type="a text" data-href="https://example.test" style="color:#112233">证据</span>');
  const result = replaceBlock(html, parseAnnotations(html).annotations, tool, "replace", env, [tool]);
  assert.equal(result.count, 1); assert.match(result.after, /--b3-inline-style-/); assert.match(result.after, /data-href=/);
  assert.equal(replaceBlock(result.after, parseAnnotations(result.after).annotations, tool, "replace", env, [tool]).count, 0);
});

test("complete-style search retains native mark fallback expressions when the mark differs from palette color 12", () => {
  const annotations = parseAnnotations(paragraph("mark", '<span data-type="mark">原生高亮</span>') + paragraph("palette", '<span data-type="text" style="background-color:var(--b3-font-background12)">调色板背景</span>')).annotations;
  const query = emptyQuery();
  query.rule = { kind: "condition", field: "signature", value: visualSignature(appearanceOf(annotations[0])), exclude: false };
  assert.match(query.rule.value, /--b3-protyle-inline-mark-background/);
  const engine = new QueryEngine([], { "--b3-protyle-inline-mark-background": "rgb(252, 212, 126)", "--b3-font-background12": "#fff88f" });
  assert.deepEqual(engine.select(annotations, query).map(a => a.blockId), ["mark"]);
});

test("native sync ignores late responses and retains its last successful library on failure", async () => {
  const library = new NativeStyleLibrary(), originalFetch = globalThis.fetch;
  const responses: ((response: Response) => void)[] = [];
  globalThis.fetch = (() => new Promise<Response>(resolve => responses.push(resolve))) as typeof fetch;
  const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
  try {
    const old = library.refresh(), latest = library.refresh();
    responses[1](response(sample())); await latest;
    responses[0](response(emptyNativeStyles())); await old;
    assert.equal(library.data.styles.length, 2); assert.equal(library.revision, 1);
    globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
    await library.refresh();
    assert.equal(library.status, "error"); assert.equal(library.data.styles.length, 2); assert.equal(library.revision, 1);
    globalThis.fetch = (async () => response(emptyNativeStyles())) as typeof fetch;
    await library.refresh(); assert.equal(library.status, "ready"); assert.equal(library.revision, 2);
  } finally { globalThis.fetch = originalFetch; library.stop(); }
});
