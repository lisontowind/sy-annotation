import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexEngine, parseAnnotations, STYLES, type AnnotationDelta } from "../src/model";
import { appearanceOf } from "../src/appearance";
import { focusAnnotation } from "../src/editor";
import { QueryEngine, emptyQuery } from "../src/filters";
import { nearestAnnotation, readingPosition } from "../src/location";
import { replaceBlock } from "../src/replacement";
import { installDOM, paragraph as p } from "./dom";

const mark = (text: string) => `<span data-type="mark">${text}</span>`;
const memo = (text: string, content = "解释") =>
  `<span data-type="mark inline-memo" data-inline-memo-content="${content}">${text}</span>`;
const markedText = "前文关键词后文";
const markedMemo = () => p("p", mark("前文") + memo("关键词") + mark("后文"));

test("inline memos do not split adjacent or nested identical annotation styles", () => {
  const baseline = parseAnnotations(p("p", mark(markedText))).annotations;
  for (const html of [
    markedMemo(),
    p("p", `<span data-type="mark">前文<span data-type="inline-memo" data-inline-memo-content="解释">关键词</span>后文</span>`),
    p("p", memo("前文") + mark("关键词后文")),
    p("p", mark("前文关键词") + memo("后文")),
    p("p", memo("前文", "第一条") + mark("关键词") + memo("后文", "第二条")),
  ]) {
    assert.deepEqual(parseAnnotations(html).annotations, baseline, html);
  }
  for (const [type, style] of [
    ["text", "background-color:var(--b3-font-background12)"],
    ["text", "color:var(--b3-font-color1)"],
    ["u", "text-decoration-style:wavy"],
  ]) {
    const span = (text: string, note = false) => `<span data-type="${type}${note ? " inline-memo" : ""}" style="${style}"${note ? ' data-inline-memo-content="解释"' : ""}>${text}</span>`;
    assert.deepEqual(
      parseAnnotations(p("p", span("前文") + span("关键词", true) + span("后文"))).annotations,
      parseAnnotations(p("p", span(markedText))).annotations,
    );
  }
});

test("memo merging preserves real formatting boundaries, unmarked gaps and block boundaries", () => {
  const variants = [
    '<span data-type="mark strong inline-memo" data-inline-memo-content="解释">关键词</span>',
    '<span data-type="mark inline-memo text" style="color:red" data-inline-memo-content="解释">关键词</span>',
    '<span data-type="mark inline-memo text" style="font-size:20px" data-inline-memo-content="解释">关键词</span>',
  ];
  for (const middle of variants) {
    const annotations = parseAnnotations(p("p", mark("前文") + middle + mark("后文"))).annotations;
    assert.deepEqual(annotations.map(a => [a.text, a.start, a.end]), [["前文", 0, 2], ["关键词", 2, 5], ["后文", 5, 7]]);
    assert.notEqual(annotations[0].signature, annotations[1].signature);
  }
  for (const gap of ["关键词", '<span data-type="inline-memo" data-inline-memo-content="解释">关键词</span>']) {
    assert.deepEqual(
      parseAnnotations(p("p", mark("前文") + gap + mark("后文"))).annotations.map(a => [a.text, a.start, a.end]),
      [["前文", 0, 2], ["后文", 5, 7]],
    );
  }
  assert.equal(parseAnnotations(p("p", '<span data-type="inline-memo" data-inline-memo-content="解释">关键词</span>')).annotations.length, 0);
  assert.deepEqual(
    parseAnnotations(p("a", mark("前文")) + p("b", memo("后文"))).annotations.map(a => [a.blockId, a.text]),
    [["a", "前文"], ["b", "后文"]],
  );
});

test("adding, editing and removing inline memos leaves incremental annotation identity stable", () => {
  const engine = new IndexEngine("doc");
  const index = engine.load(p("p", mark(markedText)));
  const original = index.annotations[0];
  for (const html of [markedMemo(), markedMemo().replace('content="解释"', 'content="修改后的解释"'), p("p", mark(markedText))]) {
    const delta = engine.patchIncremental([{ action: "update", id: "p", html }]) as AnnotationDelta;
    assert.deepEqual(delta.updatedBlocks, ["p"]);
    assert.deepEqual(delta.annotations, []);
    assert.strictEqual(index.annotations[0], original);
    assert.deepEqual(index, new IndexEngine("doc").load(html));
  }
  const html = markedMemo().replace("关键词", "新的关键词");
  const delta = engine.patchIncremental([{ action: "update", id: "p", html }]) as AnnotationDelta;
  assert.equal(delta.annotations.length, 1);
  assert.equal(index.annotations[0].text, "前文新的关键词后文");
  assert.deepEqual(index, new IndexEngine("doc").load(html));
});

test("search and navigation address a whole annotation across an inline memo", () => {
  installDOM(markedMemo());
  const index = parseAnnotations(markedMemo());
  const annotation = index.annotations[0];
  const query = { ...emptyQuery(), search: markedText };
  assert.deepEqual(new QueryEngine(STYLES, {}).select(index.annotations, query), [annotation]);
  const block = document.querySelector<HTMLElement>('[data-node-id="p"]')!;
  block.scrollIntoView = () => undefined;
  focusAnnotation(block, annotation);
  assert.equal(window.getSelection()!.toString(), markedText);
  const node = block.querySelector('[data-type~="inline-memo"]')!.firstChild!;
  const position = readingPosition(node, 1)!;
  assert.deepEqual(position, { blockId: "p", offset: 3 });
  assert.strictEqual(nearestAnnotation(index, position), annotation);
});

test("replacing a merged annotation preserves distinct memo contents and their exact text ranges", () => {
  installDOM();
  const html = p("p", mark("甲") + memo("重复", "第一条 &amp; &quot;引号&quot;") + mark("乙") + memo("重复", "第二条&#10;换行") + mark("丙"));
  const annotations = parseAnnotations(html).annotations;
  assert.equal(annotations.length, 1);
  for (const mode of ["replace", "preserve"] as const) {
    const result = replaceBlock(html, annotations, STYLES[2], mode, {}, STYLES);
    assert.equal(result.count, 1);
    const template = document.createElement("template"); template.innerHTML = result.after;
    assert.deepEqual(
      [...template.content.querySelectorAll('[data-type~="inline-memo"]')].map(node => [node.textContent, node.getAttribute("data-inline-memo-content")]),
      [["重复", '第一条 & "引号"'], ["重复", "第二条\n换行"]],
    );
    const updated = parseAnnotations(result.after).annotations;
    assert.equal(updated.length, 1);
    assert.equal(updated[0].text, "甲重复乙重复丙");
    assert.deepEqual([updated[0].start, updated[0].end], [0, 7]);
    assert.deepEqual(appearanceOf(updated[0]).styles, STYLES[2].styles);
    assert.deepEqual(appearanceOf(updated[0]).marks, []);
    assert.equal(replaceBlock(result.after, updated, STYLES[2], mode, {}, STYLES).count, 0);
  }
});

test("replacing one real style run retains memo boundaries and leaves adjacent runs unchanged", () => {
  installDOM();
  const html = p("p", mark("前文") + '<span data-type="mark strong inline-memo" data-inline-memo-content="解释">关键词</span>' + mark("后文"));
  const annotations = parseAnnotations(html).annotations;
  assert.equal(annotations.length, 3);
  const result = replaceBlock(html, [annotations[1]], STYLES[2], "preserve", {}, STYLES);
  const updated = parseAnnotations(result.after).annotations;
  assert.equal(updated.length, 3);
  assert.deepEqual(updated[0], annotations[0]);
  assert.deepEqual(updated[2], annotations[2]);
  assert.deepEqual(appearanceOf(updated[1]).marks, ["strong"]);
  const template = document.createElement("template"); template.innerHTML = result.after;
  const note = template.content.querySelector('[data-type~="inline-memo"]')!;
  assert.equal(note.textContent, "关键词");
  assert.equal(note.getAttribute("data-inline-memo-content"), "解释");
});
