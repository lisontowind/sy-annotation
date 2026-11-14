import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnnotations, buildOutline } from "../src/model";
import { installDOM, paragraph as p, heading as h } from "./dom";

installDOM();
const mark = (text: string) => `<span data-type="mark">${text}</span>`;

test("heading stack follows skipped levels and resets at same-level and root headings", () => {
  const dom =
    p("intro", mark("序言")) +
    h("a", 1, "第一章") +
    h("b", 3, "跳级标题") +
    p("p1", mark("重点")) +
    h("c", 2, "第二节") +
    p("p2", mark("其他")) +
    h("d", 1, "下一章") +
    h("e", 6, "细节") +
    p("p3", mark("深入"));
  const { annotations } = parseAnnotations(dom);
  assert.deepEqual(
    annotations.map((item) => item.headings.map((heading) => heading.id)),
    [[], ["a", "b"], ["a", "c"], ["d", "e"]],
  );
  const outline = buildOutline(annotations);
  assert.equal(outline.count, 4);
  assert.equal(outline.annotations[0].text, "序言");
  assert.deepEqual(
    outline.children.map((child) => child.count),
    [2, 1],
  );
  assert.equal(outline.children[0].children[0].heading?.level, 3);
});

test("nested list containers do not duplicate annotations and distinct combinations stay separate", () => {
  const dom = `<div data-node-id="root" data-type="NodeDocument"><div data-node-id="list" data-type="NodeList"><div data-node-id="li" data-type="NodeListItem">${p("p", `<span data-type="mark">阅读<span data-type="strong">很重要</span></span>间隔${mark("再读")}`)}</div></div></div>`;
  const { annotations } = parseAnnotations(dom);
  assert.deepEqual(
    annotations.map((item) => [item.text, item.blockId, item.start]),
    [
      ["阅读", "p", 0],
      ["很重要", "p", 2],
      ["再读", "p", 7],
    ],
  );
});

test("recognizes native highlights, foreground colors, underline and unknown backgrounds", () => {
  const { annotations } = parseAnnotations(
    p(
      "p",
      '<span data-type="text" style="background-color: var(--b3-font-background12)">黄</span> <span data-type="text" style="background-color: var(--b3-font-background3)">蓝</span> <span data-type="text" style="background-color: #bbaa00">其他</span> <span data-type="u">线</span> <span style="color:red">不算</span> <span style="background-color:transparent">不算</span>',
    ),
  );
  assert.deepEqual(
    annotations.map((item) => item.styleId),
    ["yellow", "blue", "other", "underline", "other"],
  );
});

test("excludes embedded, code and editor UI content and normalizes editor zero-width markers", () => {
  const { annotations } = parseAnnotations(
    p("p", mark("\u200b需要\ufeff记住")) +
      `<div data-node-id="code" data-type="NodeCodeBlock">${p("nested", mark("忽略代码"))}</div>` +
      `<div data-node-id="embed" data-type="NodeBlockQueryEmbed">${p("ref", mark("忽略嵌入"))}</div>` +
      `<div data-node-id="p2" data-type="NodeParagraph"><div class="protyle-attr">${mark("忽略属性")}</div></div>`,
  );
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].text, "需要记住");
  assert.equal(annotations[0].end, 4);
});

test("filter matches ancestor headings and keeps only relevant hierarchy", () => {
  const dom =
    h("h1", 1, "Reading") +
    h("h2", 2, "方法") +
    p(
      "p",
      '<span data-type="u">实践</span> 和 <span data-type="mark">坚持</span>',
    );
  const { annotations } = parseAnnotations(dom);
  const result = buildOutline(annotations, "reading", "underline");
  assert.equal(result.count, 1);
  assert.equal(result.children[0].children[0].annotations[0].text, "实践");
  assert.equal(buildOutline(annotations, "missing").count, 0);
});

test("adjacent matching highlights merge, separate occurrences stay individually addressable", () => {
  const { annotations } = parseAnnotations(
    p("p", `${mark("重点")}${mark("内容")}间隔${mark("重点")}`),
  );
  assert.deepEqual(
    annotations.map((item) => [item.text, item.start, item.end]),
    [
      ["重点内容", 0, 4],
      ["重点", 6, 8],
    ],
  );
  assert.notEqual(annotations[0].key, annotations[1].key);
});
