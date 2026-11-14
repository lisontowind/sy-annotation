import test from "node:test";
import assert from "node:assert/strict";
import { IndexEngine } from "../src/model";
import { nearestAnnotation, readingPosition } from "../src/location";
import { installDOM, heading as h, paragraph as p } from "./dom";

test("current position distinguishes repeated marks and chooses nearby runs within a section", () => {
  const index = new IndexEngine("doc").load(
    h("h1", 1, "第一章") + p("p1", '<span data-type="mark">相同</span>间隔<span data-type="mark">相同</span>') +
    p("p2", "没有标注") + p("p3", '<span data-type="mark">后面的标注</span>') +
    h("h2", 1, "无关章节") + p("p4", '<span data-type="mark">无关标注</span>'),
  );
  assert.equal(nearestAnnotation(index, { blockId: "p1", offset: 1 })?.start, 0);
  assert.equal(nearestAnnotation(index, { blockId: "p1", offset: 5 })?.start, 4);
  assert.equal(nearestAnnotation(index, { blockId: "p1", offset: 3 })?.start, 4);
  assert.equal(nearestAnnotation(index, { blockId: "p1", offset: 2 })?.start, 0,
    "the end boundary remains a nearby navigation target even outside the annotation range");
  assert.equal(nearestAnnotation(index, { blockId: "p2", offset: 0 })?.blockId, "p3");
  assert.equal(nearestAnnotation(index, { blockId: "h1", offset: 0 })?.blockId, "p1");
  assert.equal(nearestAnnotation(index, { blockId: "missing", offset: 0 }), undefined);
});

test("nearest location supports introductions, heading-free documents, ancestors and index edits", () => {
  const engine = new IndexEngine("doc");
  let index = engine.load(p("intro", '<span data-type="mark">开头</span>') + h("parent", 1, "父章节") +
    p("marked", '<span data-type="mark">祖先标注</span>') + h("child", 2, "空小节") + p("plain", "正文") +
    h("other", 1, "空章节") + p("unrelated", "正文"));
  assert.equal(nearestAnnotation(index, { blockId: "intro", offset: 1 })?.blockId, "intro");
  assert.equal(nearestAnnotation(index, { blockId: "plain", offset: 0 })?.blockId, "marked");
  assert.equal(nearestAnnotation(index, { blockId: "unrelated", offset: 0 }), undefined);
  index = engine.patch([{ action: "update", id: "plain", html: p("plain", '<span data-type="mark">新标注</span>') }])!;
  assert.equal(nearestAnnotation(index, { blockId: "plain", offset: 0 })?.blockId, "plain");
  const noHeadings = new IndexEngine("plain-doc").load(p("first", "正文") + p("last", '<span data-type="mark">最后</span>'));
  assert.equal(nearestAnnotation(noHeadings, { blockId: "first", offset: 0 })?.blockId, "last");
});

test("caret offsets match indexed text across inline nodes and ignore controls, hidden text and child blocks", () => {
  installDOM(p("block", '甲\u200b<span contenteditable="false">控件</span><span data-type="mark">乙\ufeff丙</span>丁') +
    `<div data-node-id="container"><span>前</span>${p("nested", "子块")}</div>`);
  const block = document.querySelector('[data-node-id="block"]')!;
  const mark = block.querySelector('[data-type="mark"]')!;
  assert.deepEqual(readingPosition(mark.firstChild!, 3), { blockId: "block", offset: 3 });
  const content = block.querySelector('[contenteditable="true"]')!;
  assert.deepEqual(readingPosition(content, 2), { blockId: "block", offset: 1 });
  assert.deepEqual(readingPosition(content, 3), { blockId: "block", offset: 3 });
  assert.deepEqual(readingPosition(document.querySelector('[data-node-id="nested"] [contenteditable]')!.firstChild!, 1), { blockId: "nested", offset: 1 });
  assert.equal(readingPosition(document.body, 0), undefined);
});
