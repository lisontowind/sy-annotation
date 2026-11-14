import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, paragraph as p } from "./dom";
import { parseAnnotations, STYLES } from "../src/model";
import { replaceBlock, snapshotBlocks } from "../src/replacement";
import { BatchProgressView } from "../src/batch-progress";
import { appearanceOf, matchesTool, visualSignature } from "../src/appearance";
import { QueryEngine, emptyQuery } from "../src/filters";

const env = { "--b3-font-background12": "#ffff00", "--b3-font-background3": "#00ffff", "--b3-protyle-inline-mark-background": "#ffff00" };
test("large snapshots select exact block IDs without loading the editor and reject missing blocks", () => {
  installDOM();
  const html = '<div data-node-id="parent" data-type="NodeList">' + p("a", "甲") + p("b", "乙") + '</div>';
  const snapshots = snapshotBlocks(html, ["b", "a"]);
  assert.equal(snapshots.size, 2);
  assert.ok(snapshots.get("b")!.includes("乙"));
  assert.equal(document.querySelector("[data-node-id]"), null);
  assert.throws(() => snapshotBlocks(html, ["missing"]), /不存在/);
});
test("batch progress reports measured preparation and confirmation counts and indeterminate native saving", () => {
  installDOM(); const view = new BatchProgressView(); document.body.append(view.element);
  try {
    view.begin(); view.update({ phase: "preparing", completed: 120, total: 3000 });
    const bar = view.element.querySelector("progress")!;
    assert.equal(bar.value, 120); assert.equal(bar.max, 3000);
    assert.match(view.element.textContent!, /已准备 120 \/ 3,000/);
    view.update({ phase: "saving", completed: 0, total: 3000 });
    assert.equal(bar.hasAttribute("value"), false);
    assert.match(view.element.textContent!, /已完成 0 \/ 3,000/);
    assert.match(view.element.textContent!, /内核正在处理/);
    view.update({ phase: "verifying", completed: 1400, total: 3000 });
    assert.equal(bar.value, 1400);
    view.update({ phase: "done", completed: 3000, total: 3000 });
    assert.equal(bar.value, 3000);
    view.hide(); assert.ok(view.element.hidden);
  } finally { view.destroy(); }
});
test("visual signatures ignore link/reference semantics and normalize colors and theme variables", () => {
  const a = parseAnnotations(p("p", '<span data-type="a mark" data-href="https://example.com">甲</span><span data-type="text" style="background-color:rgb(255,255,0)">乙</span>')).annotations;
  assert.equal(visualSignature(appearanceOf(a[0]), env), visualSignature(appearanceOf(a[1]), env));
  assert.ok(matchesTool(appearanceOf(a[0]), STYLES[0], env));
});
test("replacement strips inherited formatting exactly while preserving links, references and surrounding text", () => {
  installDOM();
  const html = p("p", '<strong><span data-type="u text" style="color:#ff0000;background-color:#ffff00;text-decoration-style:wavy">重复<a data-type="a" href="https://example.com">重复</a><span data-type="block-ref" data-id="ref">引用</span></span></strong>未改');
  const annotations = parseAnnotations(html).annotations;
  const selected = annotations.find((a) => a.text === "重复" && a.start === 2)!;
  assert.ok(selected);
  const result = replaceBlock(html, [selected], STYLES[2], "replace", env, STYLES);
  const parsed = parseAnnotations(result.after).annotations;
  const changed = parsed.find((a) => a.start === 2)!;
  assert.ok(matchesTool(appearanceOf(changed), STYLES[2], env));
  assert.deepEqual(appearanceOf(changed).marks, []);
  assert.equal(appearanceOf(changed).styles.color, undefined);
  assert.equal(appearanceOf(parsed.find((a) => a.start === 0)!).styles.color, "rgb(255,0,0)");
  const container = document.createElement("div"); container.innerHTML = result.after;
  assert.equal(container.querySelector('[data-type~="a"]')?.getAttribute("data-href"), "https://example.com");
  assert.equal(container.querySelector('[data-type~="a"] [data-type]'), null, "selected native inline marks must not nest");
  assert.equal(container.querySelector('[data-type~="block-ref"]')?.getAttribute("data-id"), "ref");
  assert.equal(container.textContent, "重复重复引用未改");
});
test("preserve replaces annotation effects and keeps extra typography independently of source tools", () => {
  installDOM();
  const html = p("p", '<span data-type="strong em u s sup text" style="color:#ff0000;background-color:#f0f;text-shadow:1px 1px #000;font-family:serif;font-size:20px;text-decoration-style:wavy">旧工具已删除</span>');
  const original = parseAnnotations(html).annotations;
  const preserved = replaceBlock(html, original, STYLES[2], "preserve", env, STYLES);
  const a = appearanceOf(parseAnnotations(preserved.after).annotations[0]);
  assert.deepEqual([...a.marks].sort(), ["em", "strong", "sup"]);
  assert.equal(a.styles["font-size"], "20px");
  assert.equal(a.styles["font-family"], "serif");
  assert.equal(a.styles["text-shadow"], undefined);
  assert.equal(a.styles.color, undefined);
  const sub = { ...STYLES[2], marks: ["sub" as const] };
  const b = appearanceOf(parseAnnotations(replaceBlock(html, original, sub, "preserve", env, STYLES).after).annotations[0]);
  assert.ok(b.marks.includes("sub")); assert.ok(!b.marks.includes("sup"));
  const full = appearanceOf(parseAnnotations(replaceBlock(html, original, STYLES[2], "replace", env, STYLES).after).annotations[0]);
  assert.equal(full.styles["font-size"], undefined); assert.deepEqual(full.marks, []);
});
test("multiple ranges in one block remain exact and stale offsets never fall back to duplicate text", () => {
  installDOM();
  const html = p("p", '<span data-type="u">重复</span>间隔<span data-type="u">重复</span>');
  const annotations = parseAnnotations(html).annotations;
  const result = replaceBlock(html, annotations, STYLES[2], "replace", env, STYLES);
  assert.equal(result.count, 2);
  assert.equal(parseAnnotations(result.after).annotations.length, 2);
  assert.throws(() => replaceBlock(html.replace("间隔", "变长的间隔"), [annotations[1]], STYLES[2], "replace", env, STYLES), /已变化/);
  const identical = replaceBlock(result.after, parseAnnotations(result.after).annotations, STYLES[2], "replace", env, STYLES);
  assert.equal(identical.count, 0); assert.equal(identical.after, result.after);
});
test("nested AND/OR, exclusions, visual signatures, tool subsets, colors and descendant headings combine", () => {
  const annotations = parseAnnotations('<div data-node-id="h" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">章节</div></div>' +
    p("p", '<span data-type="strong text" style="background-color:#ffff00">黄色加粗</span><span data-type="u text" style="background-color:#00ffff;text-decoration-style:wavy">蓝色波浪</span>')).annotations;
  const engine = new QueryEngine(STYLES, env);
  const query = emptyQuery(); query.rule = { kind: "group", op: "and", children: [
    { kind: "group", op: "or", children: [
      { kind: "condition", field: "tool", value: "yellow", exclude: false },
      { kind: "condition", field: "line", value: "wavy", exclude: false },
    ] },
    { kind: "condition", field: "heading", value: "h", exclude: false },
    { kind: "condition", field: "strong", value: "yes", exclude: true },
  ] };
  assert.equal(engine.select(annotations, query)[0].text, "蓝色波浪");
  assert.equal(engine.select(annotations, { ...emptyQuery(), quick: "yellow" }).length, 1);
  assert.ok(engine.rule(annotations[0], { kind: "condition", field: "color", value: "__unset__", exclude: false }));
  assert.ok(engine.rule(annotations[1], { kind: "condition", field: "signature", value: visualSignature(appearanceOf(annotations[1]), env), exclude: false }));
});
