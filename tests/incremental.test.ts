import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexEngine, applyAnnotationDelta, type AnnotationDelta } from "../src/model";
import { VirtualList, type VirtualRow } from "../src/virtual-list";
import { installDOM, paragraph as p, heading as h } from "./dom";

test("leaf typing sends only changed annotations, preserves other objects and stays equal to a fresh index", () => {
  const engine = new IndexEngine("doc");
  const first = h("h", 1, "章"); const stable = p("stable", '<span data-type="u">保留对象</span>');
  const source = first + p("plain", "没有标注") + p("marked", '<span data-type="mark">原文</span>') + stable;
  const index = engine.load(source); const stableObject = index.annotations[1];
  const plain = engine.patchIncremental([{ action: "update", id: "plain", html: p("plain", "普通输入") }]) as AnnotationDelta;
  assert.deepEqual(plain.annotations, []); assert.deepEqual(plain.updatedBlocks, ["plain"]);
  const delta = engine.patchIncremental([
    { action: "update", id: "marked", html: p("marked", '<span data-type="u">中间值</span>') },
    { action: "update", id: "marked", html: p("marked", '<span data-type="mark">最终值</span>') },
  ]) as AnnotationDelta;
  assert.equal(delta.annotations.length, 1); assert.equal(delta.annotations[0].annotations[0].text, "最终值");
  assert.strictEqual(index.annotations[1], stableObject);
  const expected = new IndexEngine("doc").load(first + p("plain", "普通输入") + p("marked", '<span data-type="mark">最终值</span>') + stable);
  assert.deepEqual(index, expected);
  // Host reconstruction and Worker state must produce the same ordering.
  const host = new IndexEngine("doc").load(source); applyAnnotationDelta(host, delta);
  assert.deepEqual(host.annotations, index.annotations);
  const removed = engine.patchIncremental([{ action: "update", id: "marked", html: p("marked", "清除标注") }]) as AnnotationDelta;
  assert.deepEqual(removed.annotations[0].annotations, []); assert.equal(index.annotations.length, 1);
  const inserted = engine.patchIncremental([{ action: "update", id: "plain", html: p("plain", '<span data-type="u">新增标注</span>') }]) as AnnotationDelta;
  assert.equal(inserted.annotations.length, 1); assert.deepEqual(index.annotations.map((a) => a.blockId), ["plain", "stable"]);
});

test("heading/container structural updates after leaf deltas still rebuild correct ownership", () => {
  const engine = new IndexEngine("doc"); engine.load(h("h", 1, "第一章") + p("p", '<span data-type="mark">内容</span>'));
  engine.patchIncremental([{ action: "update", id: "p", html: p("p", '<span data-type="u">改过内容</span>') }]);
  const result = engine.patchIncremental([{ action: "update", id: "h", html: h("h", 2, "新标题") }]);
  assert.ok(result && !("updatedBlocks" in result));
  assert.equal(result.annotations[0].headings[0].text, "新标题");
  const moved = engine.patchIncremental([{ action: "insert", id: "first", parentId: "doc", previousId: "h", html: p("first", '<span data-type="mark">插入</span>') }]);
  assert.ok(moved && !("updatedBlocks" in moved));
  assert.deepEqual(moved.annotations.map((a) => a.blockId), ["first", "p"]);
});

test("a large batch of leaf edits merges additions and removals without losing order or heading paths", () => {
  const source = Array.from({ length: 10000 }, (_, i) => (i % 100 === 0 ? h(`h${i}`, 1, `章节 ${i}`) : "") + p(`p${i}`, i < 3000 ? `<span data-type="mark">标注 ${i}</span>` : `正文 ${i}`)).join("");
  const engine = new IndexEngine("doc"); const index = engine.load(source);
  const changes = Array.from({ length: 3000 }, (_, i) => ({ action: "update" as const, id: `p${i}`, html: p(`p${i}`, i % 3 === 0 ? `移除标注 ${i}` : `<span data-type="u">修改标注 ${i}</span>`) }));
  const result = engine.patchIncremental(changes) as AnnotationDelta;
  assert.equal(result.updatedBlocks.length, 3000); assert.equal(result.annotations.length, 3000);
  assert.equal(index.annotations.length, 2000);
  assert.deepEqual(index.annotations.slice(0, 3).map((a) => a.blockId), ["p1", "p2", "p4"]);
  assert.equal(index.annotations.at(-1)!.blockId, "p2999");
  assert.equal(index.annotations.at(-1)!.headings[0].id, "h2900");
  const restored = engine.patchIncremental(changes.map((change, i) => ({ ...change, html: p(`p${i}`, `<span data-type="mark">标注 ${i}</span>`) }))) as AnnotationDelta;
  assert.equal(restored.annotations.length, 3000); assert.equal(index.annotations.length, 3000);
  assert.deepEqual(index, new IndexEngine("doc").load(source));
});

test("virtual rows reuse unchanged DOM, replace just changed content and keep rendering bounded", () => {
  installDOM(); const viewport = document.createElement("div"); document.body.append(viewport);
  Object.defineProperty(viewport, "clientHeight", { value: 120 });
  const virtual = new VirtualList(viewport);
  const rows = (version = 0): VirtualRow[] => Array.from({ length: 10000 }, (_, i) => ({
    key: `row-${i}`, estimate: 40, version: i === 1 ? version : 0,
    render: () => { const node = document.createElement("span"); node.textContent = `${i}:${version}`; return node; },
  }));
  virtual.setRows(rows()); const before = viewport.querySelector('[data-key="row-0"]'); const changed = viewport.querySelector('[data-key="row-1"]');
  virtual.setRows(rows()); assert.strictEqual(viewport.querySelector('[data-key="row-0"]'), before); assert.strictEqual(viewport.querySelector('[data-key="row-1"]'), changed);
  virtual.setRows(rows(1)); assert.strictEqual(viewport.querySelector('[data-key="row-0"]'), before); assert.notStrictEqual(viewport.querySelector('[data-key="row-1"]'), changed);
  assert.equal(viewport.querySelector('[data-key="row-1"]')?.textContent, "1:1");
  assert.ok(viewport.querySelectorAll(".sya-virtual-row").length < 30);
  assert.ok(virtual.scrollToKey("row-9999")); assert.ok(viewport.querySelector('[data-key="row-9999"]'));
  virtual.destroy();
});
