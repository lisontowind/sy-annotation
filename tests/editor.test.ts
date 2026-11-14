import { test } from "node:test";
import assert from "node:assert/strict";
import type { IProtyle } from "siyuan";
import {
  applyAnnotation,
  focusAnnotation,
  validateSelection,
} from "../src/editor";
import { STYLES, parseAnnotations } from "../src/model";
import { installDOM, paragraph as p } from "./dom";

function editor(content: string) {
  installDOM(
    `<div id="editor"><div class="protyle-wysiwyg">${content}</div></div>`,
  );
  const calls: unknown[][] = [];
  const protyle = {
    element: document.querySelector("#editor"),
    disabled: false,
    wysiwyg: { element: document.querySelector(".protyle-wysiwyg") },
    toolbar: {
      element: document.createElement("div"),
      setInlineMark: (...args: unknown[]) => {
        calls.push(args);
        return [];
      },
    },
    getInstance: () => ({
      updateBatchTransaction: (
        blocks: HTMLElement[],
        callback: (block: HTMLElement) => void,
      ) => {
        const before = blocks.map((block) => block.outerHTML);
        blocks.forEach(callback);
        const after = blocks.map((block) => block.outerHTML);
        if (JSON.stringify(before) !== JSON.stringify(after))
          calls.push([
            blocks.map((block) => block.dataset.nodeId),
            before,
            after,
          ]);
      },
    }),
  } as unknown as IProtyle;
  return { protyle, calls };
}
function rangeIn(selector: string, start = 0, end?: number) {
  const node = document.querySelector(selector)!.firstChild!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end ?? node.textContent!.length);
  return range;
}

test("painting makes one native batch and changes only the exact selected text", () => {
  const { protyle, calls } = editor(p("p", "高亮这一段文字"));
  const range = rangeIn('[contenteditable="true"]', 2, 5);
  assert.equal(applyAnnotation({ protyle, range }, STYLES[2]), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], ["p"]);
  assert.equal(
    document.querySelector('span[data-type="text"]')!.textContent,
    "这一段",
  );
  assert.equal(
    (document.querySelector('span[data-type="text"]') as HTMLElement).style
      .backgroundColor,
    "var(--b3-font-background3)",
  );
  assert.equal(protyle.toolbar!.range.toString(), "这一段");
});

test("empty, readonly, disconnected and external selections cannot write", () => {
  const { protyle, calls } = editor(p("p", "正文"));
  const range = rangeIn('[contenteditable="true"]');
  range.collapse();
  assert.equal(applyAnnotation({ protyle, range }, STYLES[0]), false);
  range.selectNodeContents(document.querySelector('[contenteditable="true"]')!);
  protyle.disabled = true;
  assert.equal(validateSelection(protyle, range), false);
  protyle.disabled = false;
  protyle.element.remove();
  assert.equal(validateSelection(protyle, range), false);
  assert.equal(calls.length, 0);
});

test("cross-paragraph selections work while drags crossing a code block are rejected", () => {
  const { protyle } = editor(p("p1", "第一段") + p("p2", "第二段"));
  const range = rangeIn('[data-node-id="p1"] [contenteditable="true"]');
  range.setEnd(
    document.querySelector('[data-node-id="p2"] [contenteditable="true"]')!
      .firstChild!,
    3,
  );
  assert.equal(validateSelection(protyle, range), true);
  const code = document.createElement("div");
  code.dataset.type = "NodeCodeBlock";
  code.textContent = "代码";
  document.querySelector('[data-node-id="p2"]')!.before(code);
  assert.equal(validateSelection(protyle, range), false);
});

test("repainting an existing underline does not toggle it off", () => {
  const { protyle, calls } = editor(
    p("p", '<span data-type="u">已划线</span>'),
  );
  assert.equal(
    applyAnnotation({ protyle, range: rangeIn('[data-type="u"]') }, STYLES[4]),
    true,
  );
  assert.equal(calls.length, 0);
});

test("jump selects the second occurrence and accounts for editor zero-width characters", () => {
  const markup = p("p", '重复，<span data-type="mark">\u200b重复</span>');
  const { annotations } = parseAnnotations(markup);
  editor(markup);
  const block = document.querySelector<HTMLElement>('[data-node-id="p"]')!;
  block.scrollIntoView = () => undefined;
  focusAnnotation(block, annotations[0]);
  assert.equal(window.getSelection()!.toString(), "重复");
  assert.equal(
    window.getSelection()!.anchorNode!.parentElement!.dataset.type,
    "mark",
  );
});

test("one cross-block batch preserves references and existing bold while adding a combination", () => {
  const { protyle, calls } = editor(
    p(
      "a",
      '<span data-type="a strong" data-href="https://example.com">链接文字</span>',
    ) + p("b", "另一段"),
  );
  const range = rangeIn('[data-href="https://example.com"]', 1, 4);
  range.setEnd(
    document.querySelector('[data-node-id="b"] [contenteditable="true"]')!
      .firstChild!,
    2,
  );
  const tool = { ...STYLES[5], marks: ["u", "em"] as const };
  assert.equal(
    applyAnnotation({ protyle, range }, { ...tool, marks: [...tool.marks] }),
    true,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], ["a", "b"]);
  const annotated = document.querySelector<HTMLElement>(
    'span[data-type~="em"]',
  )!;
  assert.match(annotated.dataset.type!, /strong/);
  assert.equal(annotated.dataset.href, "https://example.com");
  assert.equal(annotated.style.textDecorationStyle, "wavy");
  assert.equal(protyle.wysiwyg!.element.textContent, "链接文字另一段");
});
