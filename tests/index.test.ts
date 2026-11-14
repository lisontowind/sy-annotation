import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexEngine, STYLES, loadToolConfig } from "../src/model";
import { transactionChanges } from "../src/changes";
import { heading as h, paragraph as p } from "./dom";

test("incremental edits, insertions, heading moves and deletes match a fresh full index", () => {
  const engine = new IndexEngine("doc");
  engine.load(
    h("h1", 1, "第一章") +
      p("p1", '<span data-type="mark">旧文字</span>') +
      h("h2", 1, "第二章") +
      p("p2", '<span data-type="mark">第二段</span>'),
  );
  let result = engine.patch([
    {
      action: "update",
      id: "p1",
      html: p("p1", '<span data-type="u">新文字</span>'),
    },
  ])!;
  assert.equal(result.annotations[0].text, "新文字");
  result = engine.patch([
    {
      action: "insert",
      id: "h3",
      html: h("h3", 2, "插入小节"),
      parentId: "doc",
      previousId: "h1",
    },
  ])!;
  assert.deepEqual(
    result.annotations[0].headings.map((heading) => heading.id),
    ["h1", "h3"],
  );
  result = engine.patch([
    { action: "move", id: "p1", parentId: "doc", previousId: "h2" },
  ])!;
  assert.deepEqual(
    result.annotations.map((annotation) =>
      annotation.headings.map((heading) => heading.id),
    ),
    [["h2"], ["h2"]],
  );
  result = engine.patch([{ action: "delete", id: "h2" }])!;
  assert.deepEqual(
    result.annotations[0].headings.map((heading) => heading.id),
    ["h1", "h3"],
  );
  result = engine.patch([
    { action: "update", id: "h3", html: h("h3", 1, "改级别") },
  ])!;
  assert.deepEqual(
    result.annotations[0].headings.map((heading) => heading.id),
    ["h3"],
  );
  const fresh = new IndexEngine("doc").load(
    h("h1", 1, "第一章") +
      h("h3", 1, "改级别") +
      p("p1", '<span data-type="u">新文字</span>') +
      p("p2", '<span data-type="mark">第二段</span>'),
  );
  assert.deepEqual(result, fresh);
});

test("replacing a container discards deleted descendants and resolves dependent changes in one batch", () => {
  const engine = new IndexEngine("doc");
  engine.load(
    `<div data-node-id="list" data-type="NodeList">${p("a", '<span data-type="mark">A</span>')}</div>`,
  );
  const result = engine.patch([
    {
      action: "update",
      id: "list",
      html: `<div data-node-id="list" data-type="NodeList">${p("b", '<span data-type="mark">B</span>')}</div>`,
    },
    {
      action: "insert",
      id: "c",
      html: p("c", '<span data-type="mark">C</span>'),
      parentId: "list",
      previousId: "b",
    },
  ])!;
  assert.equal(result.blocks.a, undefined);
  assert.deepEqual(
    result.annotations.map((item) => item.text),
    ["B", "C"],
  );
  assert.equal(
    engine.patch([{ action: "move", id: "c", parentId: "missing" }]),
    null,
  );
});

test("10,000 paragraphs and 3,000 marks are indexed in order and patching preserves complete counts", () => {
  const source: string[] = [];
  for (let i = 0; i < 10000; i++) {
    if (i % 100 === 0) source.push(h(`h${i}`, 1, `章节 ${i / 100}`));
    source.push(
      p(
        `p${i}`,
        i % 10 < 3 ? `<span data-type="mark">标注 ${i}</span>` : `正文 ${i}`,
      ),
    );
  }
  const engine = new IndexEngine("doc");
  const index = engine.load(source.join(""));
  assert.equal(index.annotations.length, 3000);
  assert.equal(index.headings.length, 100);
  assert.equal(index.order.length, 10100);
  const next = engine.patch([
    {
      action: "update",
      id: "p9999",
      html: p("p9999", '<span data-type="mark">最后新增标注</span>'),
    },
  ])!;
  assert.equal(next.annotations.length, 3001);
  assert.equal(next.annotations.at(-1)!.text, "最后新增标注");
});

test("combinations distinguish waves from solid lines and hex from RGB serialization", () => {
  const engine = new IndexEngine("doc", STYLES.map(tool => tool.id === "wave" ?
    { ...tool, styles: { ...tool.styles, "text-decoration-color": "#c65c68" } } : tool));
  const index = engine.load(
    p(
      "p",
      '<span data-type="u text" style="text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:rgb(198, 92, 104)">波浪</span><span data-type="u">实线</span>',
    ),
  );
  assert.deepEqual(
    index.annotations.map((annotation) => annotation.styleId),
    ["wave", "underline"],
  );
  assert.notEqual(
    index.annotations[0].signature,
    index.annotations[1].signature,
  );
  const before = index.annotations[0].text;
  const after = engine.setTools(STYLES.filter((tool) => tool.id !== "wave"));
  assert.equal(after.annotations[0].text, before);
  assert.equal(after.annotations[0].styleId, "other");
  assert.match(after.annotations[0].color, /198/);
});

test("transaction adapter ignores undo metadata and unrelated documents and detects rebuild cases", () => {
  const index = new IndexEngine("doc").load(p("p", "正文"));
  const data = [
    {
      doOperations: [{ action: "update", id: "p", data: p("p", "改变") }],
      undoOperations: [{ action: "delete", id: "p" }],
    },
  ];
  assert.equal(transactionChanges(data, index, "doc")!.length, 1);
  assert.deepEqual(
    transactionChanges(
      [{ action: "update", id: "other-doc", data: "x" }],
      index,
      "doc",
    ),
    [],
  );
  assert.equal(
    transactionChanges([{ action: "unknown", id: "p" }], index, "doc"),
    null,
  );
  assert.equal(transactionChanges(undefined, index, "doc"), null);
  assert.deepEqual(transactionChanges([{ action: "setAttrs", id: "doc", data: { updated: "timestamp" } }], index, "doc"), []);
  assert.deepEqual(transactionChanges([{ action: "setDocTitle", id: "doc", data: "新标题" }], index, "doc"), []);
  assert.equal(transactionChanges([{ action: "setAttrs", id: "p", data: { style: "color:red" } }], index, "doc"), null);
});

test("migration preserves selected built-in tool and accepts intentionally empty tool libraries", () => {
  const migrated = loadToolConfig(null, { styleId: "green" });
  assert.equal(migrated.selectedId, "green");
  assert.equal(migrated.version, 1);
  migrated.tools[0].label = "独立";
  assert.notEqual(STYLES[0].label, "独立");
  const empty = loadToolConfig({ version: 1, tools: [], selectedId: "green" });
  assert.equal(empty.tools.length, 0);
  assert.equal(empty.selectedId, "");
});
