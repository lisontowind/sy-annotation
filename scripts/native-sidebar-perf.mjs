import { chromium } from "playwright";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:6917";
async function api(route, body = {}) {
  const result = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(result.code, 0, result.msg); return result.data;
}
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
const workspaces = (await api("/api/system/getWorkspaces")).filter((w) => !w.closed);
assert.equal(workspaces.length, 1); assert.equal(path.resolve(workspaces[0].path), workspace);
const baseline = process.argv.includes("--baseline");
const source = baseline ? "D:/Siyuan/Siyuan/data/plugins/sy-annotation" : "dist";
const manifest = JSON.parse(await readFile(path.join(source, "plugin.json"), "utf8"));
if (baseline) assert.equal(manifest.version, "0.3.1", "Baseline requires the unchanged v0.3.1 installation");
await cp(source, path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find((n) => n.name === "Annotation v0.2 QA");
const md = ["# 编辑性能", "普通正文用于输入"];
for (let i = 0; i < 10000; i++) md.push(i < 3000 ? `==标注 ${i}==` : `普通正文 ${i}`);
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/typing-${baseline ? "baseline" : "optimized"}-${Date.now()}`, markdown: md.join("\n\n") });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction((id) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === id, doc);
  const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "3000" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  await page.evaluate(() => {
    const plugin = window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation");
    const panel = [...plugin.panels][0]; const virtual = panel.virtual;
    window.typingMetrics = { rows: 0, fullSnapshots: 0, deltas: 0, removedRows: 0, workerMs: [] };
    const setRows = virtual.setRows.bind(virtual); virtual.setRows = (...args) => { window.typingMetrics.rows++; return setRows(...args); };
    const worker = plugin.indexer.worker; const sent = new Map(); const post = worker.postMessage.bind(worker);
    worker.postMessage = (message) => { if (message.kind === "patch") sent.set(message.id, performance.now()); return post(message); };
    worker.addEventListener("message", (event) => {
      if (event.data.index) window.typingMetrics.fullSnapshots++;
      if (event.data.delta) window.typingMetrics.deltas++;
      if (sent.has(event.data.id)) { window.typingMetrics.workerMs.push(performance.now() - sent.get(event.data.id)); sent.delete(event.data.id); }
    });
    new MutationObserver((records) => { for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && node.classList.contains("sya-virtual-row")) window.typingMetrics.removedRows++; }).observe(document.querySelector(".sya-tree"), { childList: true, subtree: true });
  });
  const placeCaret = (index) => page.evaluate((index) => {
    const plugin = window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation");
    const editable = plugin.active.wysiwyg.element.querySelectorAll('[data-type="NodeParagraph"] [contenteditable="true"]')[index];
    editable.focus(); const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT); let node; let last;
    while ((node = walker.nextNode())) last = node;
    const range = document.createRange(); range.setStart(last, last.length); range.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(range);
  }, index);
  const settle = async () => {
    await page.evaluate(() => window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").active.getInstance().flushPendingTransactions());
    await page.waitForTimeout(100);
    await page.waitForFunction(() => { const p = window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation"); return !p.loading && !p.patching && !p.queued.length && !document.querySelector('.sya-tree[aria-busy="true"]'); });
  };
  await placeCaret(0); await page.keyboard.type(" plain-edit", { delay: 40 }); await settle();
  const plain = await page.evaluate(() => structuredClone(window.typingMetrics));
  await placeCaret(1); await page.keyboard.type(" marked-edit", { delay: 40 }); await settle();
  assert.ok(await page.locator(".sya-card").filter({ hasText: "marked-edit" }).count());
  const marked = await page.evaluate(() => structuredClone(window.typingMetrics));
  await page.keyboard.press("Control+z"); await settle();
  await page.keyboard.press("Control+y"); await settle();
  assert.ok(await page.locator(".sya-card").filter({ hasText: "marked-edit" }).count());
  await page.locator(".sya-search__input").fill("标注 2999");
  await page.waitForFunction(() => document.querySelector(".sya-card__text")?.textContent === "标注 2999");
  const result = { version: manifest.version, doc, plain, marked, sourceMounted: await page.locator(".protyle-wysiwyg [data-node-id]").count() };
  if (!baseline) { assert.equal(plain.rows, 0); assert.equal(marked.fullSnapshots, 0); assert.ok(marked.deltas > 0); }
  await page.screenshot({ path: `test-results/native-typing-${baseline ? "baseline" : "optimized"}.png` });
  await writeFile(`test-results/native-typing-${baseline ? "baseline" : "optimized"}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
