import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationRuns, IndexEngine, parseAnnotations, STYLES, type AnnotationDelta } from "../src/model";
import { appearanceOf } from "../src/appearance";
import { emptyQuery, QueryEngine } from "../src/filters";
import { focusAnnotation } from "../src/editor";
import { replaceBlock } from "../src/replacement";
import { renderAnnotationPreview } from "../src/ui";
import { installDOM, paragraph as p } from "./dom";

const mark = (text: string, types = "") => `<span data-type="mark ${types}">${text}</span>`;
const text = "前文关键词后文";
const wrappers = [
  ['<span data-type="a" data-href="https://example.test" data-title="链接">', '</span>'],
  ['<a href="https://example.test" title="链接">', '</a>'],
  ['<span data-type="block-ref" data-id="20261115090000-abcdefg" data-subtype="d">', '</span>'],
];
const scripts = [
  ['<sup>', '</sup>'], ['<sub>', '</sub>'],
  ['<span data-type="sup">', '</span>'], ['<span data-type="sub">', '</span>'],
  ['<span style="vertical-align:super">', '</span>'], ['<span style="vertical-align:sub">', '</span>'],
];

test("links and block references do not split identical adjacent or nested annotation styles", () => {
  const baseline = parseAnnotations(p("p", mark(text))).annotations;
  for (const [open, close] of wrappers) for (const content of [
    mark("前文") + open + mark("关键词") + close + mark("后文"),
    mark("前文" + open + "关键词" + close + "后文"),
  ]) assert.deepEqual(parseAnnotations(p("p", content)).annotations, baseline);
  for (const type of ["a", "block-ref", "inline-memo a", "block-ref inline-memo"]) {
    assert.deepEqual(parseAnnotations(p("p", mark("前文") + mark("关键词", type) + mark("后文"))).annotations, baseline);
    assert.equal(parseAnnotations(p("p", `<span data-type="${type}">未标注</span>`)).annotations.length, 0);
  }
});

test("local superscripts and subscripts merge with their surrounding annotation and retain exact runs", () => {
  for (const [open, close] of scripts) for (const content of [
    mark("前文" + open + "关键词" + close + "后文"),
    mark("前文") + open + mark("关键词") + close + mark("后文"),
    open + mark("前文") + close + mark("关键词后文"),
    mark("前文关键词") + open + mark("后文") + close,
  ]) {
    const annotations = parseAnnotations(p("p", content)).annotations;
    assert.equal(annotations.length, 1, content);
    const a = annotations[0];
    assert.deepEqual([a.text, a.start, a.end], [text, 0, 7]);
    assert.deepEqual(appearanceOf(a), appearanceOf(parseAnnotations(p("p", mark(text))).annotations[0]));
    assert.ok(a.runs);
    assert.equal(a.runs[0].start, 0);
    assert.equal(a.runs.at(-1)!.end, 7);
    assert.ok(a.runs.some(run => run.signature.includes("sup") || run.signature.includes("sub") || run.signature.includes("super")));
  }
  const a = parseAnnotations(p("p", mark("甲<sup>乙</sup><sub>丙</sub>丁"))).annotations[0];
  assert.deepEqual(annotationRuns(a).map(run => [run.start, run.end]), [[0, 1], [1, 2], [2, 3], [3, 4]]);
  const uniform = parseAnnotations(p("p", mark("甲", "sup") + mark("乙", "sup"))).annotations[0];
  assert.deepEqual(appearanceOf(uniform).marks, ["mark", "sup"]);
  assert.equal(uniform.runs, undefined);
});

test("script merging keeps real style boundaries, plain gaps and separate blocks", () => {
  for (const middle of [
    mark("关键词", "sup strong"),
    mark("关键词", "sup code"),
    '<span data-type="mark sub text" style="color:red">关键词</span>',
    '<span data-type="mark sup text" style="font-size:20px">关键词</span>',
    '<span data-type="mark a text" style="background-color:blue" data-href="https://example.test">关键词</span>',
  ]) assert.deepEqual(parseAnnotations(p("p", mark("前文") + middle + mark("后文"))).annotations.map(a => a.text), ["前文", "关键词", "后文"]);
  for (const gap of ["关键词", '<span data-type="inline-memo">关键词</span>', '<span data-type="strong">关键词</span>']) {
    assert.deepEqual(parseAnnotations(p("p", mark("前文") + gap + mark("后文"))).annotations.map(a => [a.start, a.end]), [[0, 2], [5, 7]]);
  }
  assert.equal(parseAnnotations(p("a", mark("甲", "sup")) + p("b", mark("乙"))).annotations.length, 2);
});

test("uncolored references, links and scripts bridge matching highlights after native serialization", () => {
  for (const [open, close] of [...wrappers, ...scripts,
    ['<span data-type="sup block-ref" data-id="ref" data-subtype="s">', '</span>'],
    ['<span data-type="block-ref sub" data-id="ref" data-subtype="d">', '</span>'],
  ]) {
    const html = p("p", mark("前文") + "\u200b" + open + "\u2060关键词" + close + "\u200b\u200b" + mark("后文"));
    const annotations = parseAnnotations(html).annotations;
    assert.equal(annotations.length, 1, html);
    const a = annotations[0];
    assert.deepEqual([a.text, a.start, a.end], [text, 0, 7]);
    assert.deepEqual(a.runs?.map(run => [run.start, run.end]), [[0, 2], [2, 5], [5, 7]]);
    assert.equal(appearanceOf(a.runs![1]).styles["background-color"], undefined);
    assert.equal(appearanceOf(a.runs![1]).marks.includes("mark"), false);
  }
  for (const [type, style] of [
    ["text", "color:var(--b3-card-info-color);background-color:var(--b3-card-info-background)"],
    ["text", "background-color:var(--b3-font-background12)"],
    ["u text", "text-decoration-style:wavy"],
  ]) {
    const styled = (value: string) => `<span data-type="${type}" style="${style}">${value}</span>`;
    const html = p("p", styled("前文") + '\u200b<span data-type="block-ref sup" data-id="ref">\u2060关键词</span>\u200b' + styled("后文"));
    assert.deepEqual(parseAnnotations(html).annotations.map(a => a.text), [text]);
  }
});

test("uncolored citations only join matching flanks and never absorb ordinary text or terminal references", () => {
  const ref = '<span data-type="block-ref sup" data-id="ref">\u2060引</span>';
  for (const content of [
    mark("前") + ref + '<span data-type="text" style="background-color:blue">后</span>',
    mark("前") + ref + "间隔" + mark("后"),
    mark("前") + "间隔" + ref + mark("后"),
    mark("前") + ref + " " + mark("后"),
  ]) assert.deepEqual(parseAnnotations(p("p", content)).annotations.map(a => a.text), ["前", "后"]);
  assert.deepEqual(parseAnnotations(p("p", ref + mark("前") + ref)).annotations.map(a => [a.text, a.start, a.end]), [["前", 1, 2]]);
  const html = p("p", mark("甲") + ref + '<span data-type="a" data-href="https://example.test">链</span>' + mark("乙"));
  assert.deepEqual(parseAnnotations(html).annotations.map(a => a.text), ["甲引链乙"]);
});

test("native uncolored script citations retain scopes and visible offsets through navigation and replacement", () => {
  const html = p("p", '未改' + mark("甲") + '\u200b<span data-type="sup block-ref" data-id="ref" data-subtype="s">\u2060引</span>\u200b' + mark("乙") + "未改");
  installDOM(html);
  const annotations = parseAnnotations(html).annotations, a = annotations[0];
  assert.deepEqual([a.text, a.start, a.end], ["甲引乙", 2, 5]);
  const block = document.querySelector<HTMLElement>('[data-node-id="p"]')!;
  block.scrollIntoView = () => undefined; focusAnnotation(block, a);
  assert.equal(window.getSelection()!.toString().replace(/[\u200b\u2060\ufeff]/g, ""), "甲引乙");
  for (const mode of ["replace", "preserve"] as const) {
    const result = replaceBlock(html, annotations, STYLES[2], mode, {}, STYLES);
    assert.equal(result.count, 1);
    const template = document.createElement("template"); template.innerHTML = result.after;
    const ref = template.content.querySelector<HTMLElement>('[data-type~="block-ref"]')!;
    assert.equal(ref.dataset.id, "ref"); assert.equal(ref.dataset.subtype, "s");
    assert.equal(ref.textContent?.replace(/\u2060/g, ""), "引");
    assert.equal(ref.dataset.type?.split(" ").includes("sup"), mode === "preserve");
    const updated = parseAnnotations(result.after).annotations;
    assert.deepEqual(updated.map(a => [a.text, a.start, a.end]), [["甲引乙", 2, 5]]);
    assert.equal(replaceBlock(result.after, updated, STYLES[2], mode, {}, STYLES).count, 0);
    assert.equal(template.content.textContent?.replace(/[\u200b\u2060\ufeff]/g, ""), "未改甲引乙未改");
  }
});

test("search, script filters, custom tools, previews and navigation use a whole merged annotation", () => {
  const html = p("p", mark("前文<sup>关键</sup><sub>词</sub>后文"));
  installDOM(html);
  const annotations = parseAnnotations(html).annotations, a = annotations[0];
  const tool = { ...STYLES[0], id: "sup", marks: ["mark", "sup"] as ("mark" | "sup")[], styles: {} };
  const engine = new QueryEngine([...STYLES, tool]);
  const query = emptyQuery(); query.search = text;
  assert.deepEqual(engine.select(annotations, query), [a]);
  for (const field of ["sup", "sub"] as const) {
    query.rule = { kind: "condition", field, value: "yes", exclude: false };
    assert.deepEqual(engine.select(annotations, query), [a]);
    query.rule.value = "no"; assert.deepEqual(engine.select(annotations, query), []);
    query.rule.exclude = true; assert.deepEqual(engine.select(annotations, query), [a]);
  }
  query.rule = emptyQuery().rule; query.quick = tool.id;
  assert.deepEqual(engine.select(annotations, query), [a]);
  const preview = document.createElement("span"); renderAnnotationPreview(preview, a);
  assert.equal(preview.textContent, text);
  assert.deepEqual([...preview.children].map(node => [(node as HTMLElement).style.verticalAlign, node.textContent]), [["", "前文"], ["super", "关键"], ["sub", "词"], ["", "后文"]]);
  const block = document.querySelector<HTMLElement>('[data-node-id="p"]')!;
  block.scrollIntoView = () => undefined; focusAnnotation(block, a);
  assert.equal(window.getSelection()!.toString(), text);
});

test("incremental indexing detects script range edits and ignores link identity changes", () => {
  const engine = new IndexEngine("doc");
  const html = p("p", mark("甲<sup>乙</sup>丙"));
  const index = engine.load(html), original = index.annotations[0];
  const linked = p("p", mark('甲<sup><span data-type="a" data-href="https://example.test">乙</span></sup>丙'));
  const unchanged = engine.patchIncremental([{ action: "update", id: "p", html: linked }]) as AnnotationDelta;
  assert.deepEqual(unchanged.annotations, []); assert.strictEqual(index.annotations[0], original);
  for (const content of ["甲乙<sup>丙</sup>", "甲乙<sub>丙</sub>", "甲乙丙"]) {
    const updated = p("p", mark(content));
    const delta = engine.patchIncremental([{ action: "update", id: "p", html: updated }]) as AnnotationDelta;
    assert.equal(delta.annotations.length, 1);
    assert.equal(index.annotations.length, 1);
    assert.deepEqual(index, new IndexEngine("doc").load(updated));
  }
});

test("replacement preserves exact link, reference and script scopes or removes scripts according to mode", () => {
  installDOM();
  const html = p("p", mark('甲<span data-type="a sup" data-href="https://example.test" data-title="链接">乙</span><span data-type="block-ref sub inline-memo" data-id="20261115090000-abcdefg" data-subtype="d" data-inline-memo-content="解释">丙</span>丁'));
  const annotations = parseAnnotations(html).annotations;
  assert.equal(annotations.length, 1);
  for (const mode of ["replace", "preserve"] as const) {
    const result = replaceBlock(html, annotations, STYLES[2], mode, {}, STYLES);
    assert.equal(result.count, 1);
    const template = document.createElement("template"); template.innerHTML = result.after;
    const link = template.content.querySelector<HTMLElement>('[data-href]')!;
    assert.equal(link.textContent, "乙"); assert.equal(link.dataset.href, "https://example.test"); assert.equal(link.dataset.title, "链接");
    assert.equal(link.dataset.type?.split(" ").includes("sup"), mode === "preserve");
    const ref = template.content.querySelector<HTMLElement>('[data-type~="block-ref"]')!;
    assert.equal(ref.textContent, "丙"); assert.equal(ref.dataset.id, "20261115090000-abcdefg"); assert.equal(ref.dataset.subtype, "d");
    assert.equal(ref.dataset.inlineMemoContent, "解释"); assert.equal(ref.dataset.type?.split(" ").includes("sub"), mode === "preserve");
    const updated = parseAnnotations(result.after).annotations;
    assert.equal(updated.length, 1); assert.equal(updated[0].text, "甲乙丙丁");
    assert.equal(replaceBlock(result.after, updated, STYLES[2], mode, {}, STYLES).count, 0);
  }
});

test("same-style replacement removes local scripts in replace mode and rejects changed script ranges", () => {
  installDOM();
  const html = p("p", mark("甲<sup>乙</sup>丙")), annotations = parseAnnotations(html).annotations;
  const target = { ...STYLES[0], marks: ["mark"] as "mark"[], styles: {} };
  assert.equal(replaceBlock(html, annotations, target, "preserve", {}, STYLES).count, 0);
  const result = replaceBlock(html, annotations, target, "replace", {}, STYLES);
  assert.equal(result.count, 1);
  assert.equal(parseAnnotations(result.after).annotations[0].runs, undefined);
  assert.doesNotMatch(result.after, /sup/);
  assert.throws(() => replaceBlock(p("p", mark("甲乙<sup>丙</sup>")), annotations, target, "replace", {}, STYLES), /原文或样式已变化/);
});
