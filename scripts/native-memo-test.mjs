import { chromium } from "playwright";
import { JSDOM } from "jsdom";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:6917";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(repo, "artifacts/acceptance-0.2.0/workspace");
async function api(route, body = {}) {
  const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(result.code, 0, `${route}: ${result.msg}`);
  return result.data;
}
const active = (await api("/api/system/getWorkspaces")).filter(w => !w.closed);
assert.equal(active.length, 1, "Expected one independent acceptance workspace");
assert.equal(path.resolve(active[0].path), workspace, "Refusing to modify another workspace");
await cp(path.join(repo, "dist"), path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
await mkdir(path.join(repo, "test-results"), { recursive: true });
let notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(n => n.name === "Annotation v0.2 QA");
if (!notebook) {
  await api("/api/notebook/createNotebook", { name: "Annotation v0.2 QA" });
  notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(n => n.name === "Annotation v0.2 QA");
}
const mark = text => `<span data-type="mark">${text}</span>`;
const memo = (text, content, types = "mark") => `<span data-type="${types ? types + " " : ""}inline-memo" data-inline-memo-content="${content}">${text}</span>`;
const fixtures = [
  mark("前文关键词后文"),
  mark("甲") + memo("重复", "第一处 &amp; &quot;引号&quot;") + mark("乙") + memo("重复", "第二处说明") + mark("丙"),
  mark("加粗前") + memo("加粗中", "加粗备注", "mark strong") + mark("加粗后"),
  mark("颜色前") + '<span data-type="mark text inline-memo" style="color:var(--b3-font-color1)" data-inline-memo-content="颜色备注">颜色中</span>' + mark("颜色后"),
  mark("间隔前") + memo("普通间隔", "没有高亮的备注", "") + mark("间隔后"),
  mark("跨块甲"),
  memo("跨块乙", "另一块的备注"),
];
const doc = await api("/api/filetree/createDocWithMd", {
  notebook: notebook.id,
  path: `/inline-memo-qa-${Date.now()}`,
  markdown: "# 行内备注回归\n\n" + fixtures.map((_, i) => `段落 ${i}`).join("\n\n"),
});
const parse = html => JSDOM.fragment(html);
const initial = (await api("/api/block/getBlockDOM", { id: doc })).dom;
const ids = [...parse(initial).querySelectorAll('[data-type="NodeParagraph"]')].map(n => n.getAttribute("data-node-id"));
assert.equal(ids.length, fixtures.length);
for (let i = 0; i < ids.length; i++) {
  await api("/api/block/updateBlock", { id: ids[i], dataType: "dom", data: `<div data-node-id="${ids[i]}" data-type="NodeParagraph"><div contenteditable="true">${fixtures[i]}</div></div>` });
}
const expectedTexts = [
  ["前文关键词后文"], ["甲重复乙重复丙"], ["加粗前", "加粗中", "加粗后"],
  ["颜色前", "颜色中", "颜色后"], ["间隔前", "间隔后"], ["跨块甲"], ["跨块乙"],
];
const version = await api("/api/system/version");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
let page;
const errors = [];
const phases = [];
const clean = text => text.replace(/[\u200b\ufeff]/g, "");
const source = async () => (await api("/api/block/getBlockDOM", { id: doc })).dom;
function notes(html) {
  return [...parse(html).querySelectorAll('[data-type~="inline-memo"]')].map(node => ({
    blockId: node.closest("[data-node-id]").getAttribute("data-node-id"),
    text: clean(node.textContent), content: node.getAttribute("data-inline-memo-content"),
  }));
}
const waitReady = () => page.waitForFunction(({ doc, count }) => {
  const plugin = window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation");
  return plugin?.rootId === doc && !plugin.loading && !plugin.patching && !plugin.replacing && !plugin.queued.length &&
    plugin.index?.annotations.length === count && document.querySelector(".sya-document__count")?.textContent === String(count);
}, { doc, count: expectedTexts.flat().length });
const snapshot = () => page.evaluate(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").index.annotations);
const flush = () => page.evaluate(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active.getInstance().flushPendingTransactions());
async function openDocument() {
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction(id => window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation")?.active?.block.rootID === id, doc);
  const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
  await waitReady();
}
async function history(redo = false) {
  await page.evaluate(async redo => {
    const protyle = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active;
    await protyle.undo[redo ? "redo" : "undo"](protyle);
    await protyle.getInstance().flushPendingTransactions();
  }, redo);
  await waitReady();
}
async function assertTexts() {
  const annotations = await snapshot();
  assert.deepEqual(ids.map(id => annotations.filter(a => a.blockId === id).map(a => a.text)), expectedTexts);
  return annotations;
}
try {
  await openDocument();
  const before = await assertTexts();
  // Use SiYuan's actual memo editor, including its transaction and content encoding.
  await page.evaluate(id => {
    const protyle = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active;
    const text = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"] [data-type="mark"]`).firstChild;
    const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 5);
    protyle.toolbar.range = range;
    getSelection().removeAllRanges(); getSelection().addRange(range);
    protyle.toolbar.setInlineMark(protyle, "inline-memo", "range");
  }, ids[0]);
  const nativeNote = '原生备注 & "引号"\n第二行';
  await page.locator(".protyle-util textarea").fill(nativeNote);
  await page.locator(".protyle-util textarea").press("Escape");
  await flush(); await waitReady();
  assert.deepEqual(await assertTexts(), before, "Memo insertion must leave annotation keys, offsets and styles unchanged");
  const savedNotes = notes(await source());
  assert.equal(savedNotes.length, 7);
  assert.deepEqual(savedNotes.filter(n => n.blockId === ids[0]).map(n => n.text), ["关键词"]);
  phases.push("native memo save");
  await history();
  assert.equal(notes(await source()).filter(n => n.blockId === ids[0]).length, 0);
  assert.deepEqual(await assertTexts(), before);
  await history(true);
  assert.deepEqual(notes(await source()), savedNotes);
  assert.deepEqual(await assertTexts(), before);
  phases.push("native memo undo/redo");

  // Modify just the real bold run; adjacent marks and the memo scope must survive.
  await page.evaluate(async id => {
    const plugin = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation");
    const selected = plugin.index.annotations.find(a => a.blockId === id && a.text === "加粗中");
    await plugin.actions.replaceAnnotation(selected, "blue", "preserve");
  }, ids[2]);
  await waitReady();
  const changed = await assertTexts();
  const boldBefore = before.filter(a => a.blockId === ids[2]);
  const boldAfter = changed.filter(a => a.blockId === ids[2]);
  assert.deepEqual(boldAfter[0], boldBefore[0]); assert.deepEqual(boldAfter[2], boldBefore[2]);
  assert.ok(JSON.parse(boldAfter[1].signature)[0].includes("strong"));
  assert.notEqual(boldAfter[1].signature, boldBefore[1].signature);
  assert.deepEqual(notes(await source()), savedNotes);
  await history(); assert.deepEqual(await assertTexts(), before);
  await history(true); assert.deepEqual(await assertTexts(), changed);
  assert.deepEqual(notes(await source()), savedNotes);
  await history();
  phases.push("preserve replacement and real boundaries undo/redo");

  // Two merged annotations, spanning several native memo nodes, are one batch.
  const batch = await page.evaluate(async ids => {
    const plugin = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation");
    const selected = plugin.index.annotations.filter(a => ids.includes(a.blockId));
    const signal = new AbortController().signal;
    const plan = await plugin.prepareReplacement(selected, "blue", "replace", signal, () => {});
    await plugin.commitReplacement(plan, signal, () => {});
    return { matched: plan.matched, changed: plan.changed, blocks: plan.blocks.length };
  }, ids.slice(0, 2));
  assert.deepEqual(batch, { matched: 2, changed: 2, blocks: 2 });
  await waitReady();
  const replaced = await assertTexts();
  for (const id of ids.slice(0, 2)) {
    const annotation = replaced.find(a => a.blockId === id);
    assert.deepEqual(JSON.parse(annotation.signature), [[], [["background-color", "var(--b3-font-background3)"]]]);
  }
  assert.deepEqual(notes(await source()), savedNotes);
  await history(); assert.deepEqual(await assertTexts(), before);
  assert.deepEqual(notes(await source()), savedNotes);
  await history(true); assert.deepEqual(await assertTexts(), replaced);
  assert.deepEqual(notes(await source()), savedNotes);
  phases.push("two-annotation batch save and single undo/redo");

  // Reopen in a fresh page so both the editor and the Worker load persisted DOM.
  await page.close(); await openDocument();
  assert.deepEqual(await assertTexts(), replaced);
  assert.deepEqual(notes(await source()), savedNotes);
  await page.locator(".sya-search__input").fill("前文关键词后文");
  await page.waitForFunction(() => document.querySelector(".sya-card__sample")?.textContent === "前文关键词后文");
  await page.locator(".sya-card").click();
  await page.waitForFunction(() => getSelection().toString().replace(/[\u200b\ufeff]/g, "") === "前文关键词后文");
  await page.locator(".sya-search__input").fill("");
  // Decode the reopened note using the native editor as well as comparing its stored attribute.
  await page.evaluate(id => {
    const protyle = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active;
    const note = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"] [data-type~="inline-memo"]`);
    protyle.toolbar.showRender(protyle, note);
  }, ids[0]);
  assert.equal(await page.locator(".protyle-util textarea").inputValue(), nativeNote);
  await page.locator(".protyle-util textarea").press("Escape");
  phases.push("fresh editor/Worker reopen, search, navigation and memo decoding");
  await page.screenshot({ path: path.join(repo, "test-results/native-memo-reopened.png") });

  // Check the actual .sy file, not just the editor DOM or an API response.
  const info = await api("/api/block/getBlockInfo", { id: doc });
  assert.equal(info.box, notebook.id);
  const diskPath = path.resolve(workspace, "data", notebook.id, info.path.replace(/^[/\\]+/, ""));
  assert.ok(diskPath.startsWith(path.join(workspace, "data", notebook.id) + path.sep));
  const stored = JSON.parse(await readFile(diskPath, "utf8"));
  const diskNotes = [];
  const paragraphs = new Map();
  function visit(node, blockId) {
    if (node.Type === "NodeParagraph") { blockId = node.ID; paragraphs.set(blockId, node); }
    if (node.TextMarkType?.split(" ").includes("inline-memo")) diskNotes.push({
      blockId, text: clean(parse(node.TextMarkTextContent).textContent),
      // The .sy serializer encodes newlines that getBlockDOM exposes literally.
      content: node.TextMarkInlineMemoContent?.replaceAll("_esc_newline_", "\n"),
    });
    for (const child of node.Children || []) visit(child, blockId);
  }
  visit(stored);
  assert.deepEqual(diskNotes, savedNotes, "All memo contents and ranges must be persisted");
  for (const id of ids.slice(0, 2)) {
    const runs = paragraphs.get(id).Children.filter(node => node.Type === "NodeTextMark");
    assert.ok(runs.length > 1);
    assert.ok(runs.every(node => node.Properties?.style?.includes("background-color: var(--b3-font-background3)")), "Batch color must be written to disk on every run");
  }
  phases.push("persisted .sy file");
  assert.deepEqual(errors.filter(e => e.includes("sy-annotation")), []);
  await writeFile(path.join(repo, "test-results/native-memo.json"), JSON.stringify({ version, doc, annotations: replaced.length, memos: savedNotes.length, batch, phases, errors }, null, 2));
  console.log(`Native SiYuan ${version} memo regression passed: ${replaced.length} annotations, ${savedNotes.length} memos; native save, undo/redo, real style boundaries, one batch, fresh reopen and persisted file.`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(repo, "test-results/native-memo-error.png") });
    console.log((await page.locator(".sya-panel, .protyle-util").allInnerTexts()).join("\n").slice(-1800));
  }
  console.log(JSON.stringify({ doc, phases, errors }));
  throw error;
} finally {
  await browser.close();
}
