import { chromium } from "playwright";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = "http://127.0.0.1:6917";
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
async function api(route, body = {}) {
  const result = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(result.code, 0, `${route}: ${result.msg}`); return result.data;
}
const active = (await api("/api/system/getWorkspaces")).filter(item => !item.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace);
await cp(path.resolve("dist"), path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(item => item.name === "Annotation v0.2 QA");
assert.ok(notebook);
const doc = await api("/api/filetree/createDocWithMd", {
  notebook: notebook.id, path: `/uncolored-script-citation-${Date.now()}`, markdown: "# 引用目标\n\n上标段落\n\n下标段落\n\n不同颜色\n\n普通间隔",
});
const parse = html => JSDOM.fragment(html);
const original = parse((await api("/api/block/getBlockDOM", { id: doc })).dom);
const target = original.querySelector('[data-type="NodeHeading"]').getAttribute("data-node-id");
const ids = [...original.querySelectorAll('[data-type="NodeParagraph"]')].map(node => node.getAttribute("data-node-id"));
const styled = (text, color = "info") => `<span data-type="text" style="color:var(--b3-card-${color}-color);background-color:var(--b3-card-${color}-background)">${text}</span>`;
const ref = (type, text) => `<span data-type="block-ref ${type}" data-id="${target}" data-subtype="s">${text}</span>`;
const fixtures = [
  styled("前文") + ref("sup", "引用") + styled("后文"),
  styled("下标前") + ref("sub", "引用") + styled("下标后"),
  styled("颜色前") + ref("sup", "引用") + styled("颜色后", "warning"),
  styled("间隔前") + "普通文字" + styled("间隔后"),
];
for (const [i, id] of ids.entries()) await api("/api/block/updateBlock", { id, dataType: "dom", data: `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${fixtures[i]}</div></div>` });
const clean = text => text.replace(/[\u200b\u2060\ufeff]/g, "");
const semantics = html => [...parse(html).querySelectorAll('[data-type~="block-ref"]')].map(node => ({
  block: node.closest("[data-node-id]").getAttribute("data-node-id"), text: clean(node.textContent), id: node.getAttribute("data-id"), subtype: node.getAttribute("data-subtype"),
}));
const source = async () => (await api("/api/block/getBlockDOM", { id: doc })).dom;
const before = await source();
const nativeRefs = [...parse(before).querySelectorAll('[data-type~="block-ref"]')];
assert.ok(nativeRefs.slice(0, 2).every(node => !node.getAttribute("style")), "Fixture must have genuinely uncolored citations");
assert.ok(before.includes("\u2060"), "Native script marker must be present");
const expectedSemantics = semantics(before);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const errors = [], phases = [];
let page;
async function ready() {
  await page.waitForFunction(doc => {
    const plugin = window.siyuan?.ws?.app?.plugins?.find(item => item.name === "sy-annotation");
    return plugin?.rootId === doc && !plugin.loading && !plugin.patching && !plugin.replacing && !plugin.queued.length && plugin.index?.annotations.length === 6;
  }, doc);
}
async function openDocument() {
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?id=${doc}`); await ready();
  const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
}
const flush = () => page.evaluate(() => window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").active.getInstance().flushPendingTransactions());
const annotations = () => page.evaluate(() => window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").index.annotations);
try {
  await openDocument();
  assert.deepEqual((await annotations()).map(a => a.text), ["前文引用后文", "下标前引用下标后", "颜色前", "颜色后", "间隔前", "间隔后"]);
  assert.deepEqual((await annotations()).slice(0, 2).map(a => a.runs.map(run => [run.start, run.end])), [[[0, 2], [2, 4], [4, 6]], [[0, 3], [3, 5], [5, 8]]]);
  assert.equal(await page.locator(".sya-card").count(), 6);
  await page.locator(".sya-search__input").fill("前文引用后文");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 1);
  await page.locator(".sya-card").click();
  assert.equal(clean(await page.evaluate(() => window.getSelection().toString())), "前文引用后文");
  await page.locator(".sya-search__input").fill("");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 6);
  phases.push("native uncolored superscript/subscript citations merge, real gaps remain separate, full search and navigation passed");
  for (const mode of ["preserve", "replace"]) {
    await page.evaluate(async ({ id, mode }) => {
      const plugin = window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation");
      await plugin.actions.replaceAnnotation(plugin.index.annotations.find(a => a.blockId === id), "blue", mode);
    }, { id: ids[0], mode });
    await flush(); await ready();
    const changed = await source();
    assert.deepEqual(semantics(changed), expectedSemantics);
    const block = parse(changed).querySelector(`[data-node-id="${ids[0]}"]`);
    const citation = block.querySelector('[data-type~="block-ref"]');
    assert.ok(citation.getAttribute("style")?.includes("background3"));
    assert.equal(citation.getAttribute("data-type").split(" ").includes("sup"), mode === "preserve");
    await page.evaluate(() => window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").active.undo.undo(window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").active));
    await flush();
    await page.waitForFunction(id => {
      const a = window.siyuan.ws.app.plugins.find(item => item.name === "sy-annotation").index.annotations.find(a => a.blockId === id);
      return a?.runs?.length === 3 && !JSON.parse(a.runs[1].signature)[1].length;
    }, ids[0]);
    assert.deepEqual(semantics(await source()), expectedSemantics);
    phases.push(`${mode} replacement and undo preserve citation identity and correct scripts`);
  }
  await page.close(); await openDocument();
  assert.deepEqual((await annotations()).map(a => a.text), ["前文引用后文", "下标前引用下标后", "颜色前", "颜色后", "间隔前", "间隔后"]);
  phases.push("fresh editor and Worker reopen passed");
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/native-inline-formatting.json", JSON.stringify({ doc, phases, errors }, null, 2));
  console.log(JSON.stringify({ doc, phases, errors }, null, 2));
} finally { await browser.close(); }
