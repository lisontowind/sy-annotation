import { chromium } from "playwright";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:6917";
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
async function api(route, body = {}) {
  const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(result.code, 0, `${route}: ${result.msg}`); return result.data;
}
const active = (await api("/api/system/getWorkspaces")).filter((w) => !w.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace);
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find((n) => n.name === "Annotation v0.2 QA");
assert.ok(notebook);
const markdown = [];
for (let i = 0; i < 10000; i++) {
  if (i % 100 === 0) markdown.push(`# 章节 ${i / 100}`);
  markdown.push(i < 3000 ? `==长文标注 ${i}==` : `普通正文 ${i}`);
}
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/v03-long-qa-${Date.now()}`, markdown: markdown.join("\n\n") });
const original = (await api("/api/block/getBlockDOM", { id: doc })).dom;
assert.equal((original.match(/data-type="mark"/g) || []).length, 3000);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => { if (message.text().includes("[sy-annotation]")) console.log(message.text()); });
  const waitCount = async (n) => page.waitForFunction((n) => document.querySelector(".sya-document__count")?.textContent === String(n) && !document.querySelector('.sya-tree[aria-busy="true"]'), n, { timeout: 120000 });
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction((doc) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === doc, doc, { timeout: 30000 });
  const dockType = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dockType}"]`).click();
  await waitCount(3000);
  console.log("native v3: full index ready");
  const mounted = await page.locator(".protyle-wysiwyg [data-node-id]").count(); assert.ok(mounted < 10000, `source mounted: ${mounted}`);
  // Single-card replacement persists through the native editor transaction.
  await page.locator(".sya-card").filter({ hasText: /^长文标注 0$/ }).click({ button: "right" });
  await page.locator('.sya-replace-tool[data-tool-id="wave"]').click();
  await page.waitForFunction(() => !window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").replacing && [...document.querySelectorAll(".sya-card__sample")].some((n) => getComputedStyle(n).textDecorationStyle === "wavy"), null, { timeout: 20000 });
  await waitCount(3000);
  assert.ok(/text-decoration-style:\s*wavy/.test((await api("/api/block/getBlockDOM", { id: doc })).dom), "wave must persist");
  console.log("native v3: single replacement persisted");
  await page.locator('.protyle-wysiwyg [contenteditable="true"]').first().click();
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => ![...document.querySelectorAll(".sya-card__sample")].some((n) => getComputedStyle(n).textDecorationStyle === "wavy"));
  await waitCount(3000);
  // Exact source style from the card, including all unloaded marks in this document.
  await page.locator(".sya-card").filter({ hasText: /^长文标注 0$/ }).click({ button: "right" });
  await page.locator(".sya-bulk-same").click();
  assert.equal(await page.locator(".sya-batch-source-kind").inputValue(), "signature");
  await page.locator(".sya-batch-target").selectOption("wave");
  const previewStarted = Date.now();
  await page.waitForFunction(() => {
    const status = document.querySelector(".sya-replacement-dialog .sya-dialog-status")?.textContent || "";
    if (/失败|已变化|不存在|不可读取/.test(status)) throw new Error(status);
    return document.querySelector(".sya-batch-execute")?.textContent === "修改 3000 处" && !document.querySelector(".sya-batch-execute").disabled;
  }, null, { timeout: 180000 });
  await page.screenshot({ path: "test-results/native-v3-bulk-preview.png" });
  const previewMs = Date.now() - previewStarted;
  console.log("native v3: prepared 3000 replacements");
  let rootReads = 0; let transactions = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/block/getBlockDOM") && request.postDataJSON()?.id === doc) rootReads++;
    if (request.url().endsWith("/api/transactions") && request.postDataJSON()?.transactions?.some((t) => t.doOperations?.filter((o) => o.action === "update").length >= 3000)) transactions++;
  });
  await page.locator(".sya-batch-execute").click();
  const commitStarted = Date.now();
  await page.locator('.sya-batch-progress[data-phase="saving"]').waitFor();
  const savingStarted = Date.now();
  assert.match(await page.locator('.sya-batch-count').textContent(), /已完成 0 \/ 3,000 处/);
  await page.waitForFunction(() => /思源处理中 [1-9]/.test(document.querySelector('.sya-batch-elapsed')?.textContent || ""));
  await page.screenshot({ path: "test-results/native-batch-live-progress.png" });
  await page.waitForFunction(() => {
    if (document.querySelector(".sya-batch-retry")) throw new Error(document.querySelector(".sya-replacement-dialog .sya-dialog-status")?.textContent);
    return !document.querySelector(".sya-replacement-dialog");
  }, null, { timeout: 600000 });
  await waitCount(3000);
  const commitMs = Date.now() - commitStarted;
  const after = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((after.match(/text-decoration-style:\s*wavy/g) || []).length, 3000);
  assert.equal(transactions, 1); assert.equal(rootReads, 2, "large jobs validate and verify with one snapshot each");
  const batchRootReads = rootReads;
  assert.ok(await page.locator(".sya-card").count() < 60);
  assert.ok(await page.locator(".protyle-wysiwyg [data-node-id]").count() < 10000);
  await page.locator('.protyle-wysiwyg [contenteditable="true"]').first().click();
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => ![...document.querySelectorAll(".sya-card__sample")].some((n) => getComputedStyle(n).textDecorationStyle === "wavy"), null, { timeout: 120000 });
  await waitCount(3000);
  const undo = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((undo.match(/text-decoration-style:\s*wavy/g) || []).length, 0);
  assert.equal((undo.match(/data-type="mark"/g) || []).length, 3000);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => [...document.querySelectorAll(".sya-card__sample")].some((n) => getComputedStyle(n).textDecorationStyle === "wavy"), null, { timeout: 120000 });
  await waitCount(3000);
  assert.equal(((await api("/api/block/getBlockDOM", { id: doc })).dom.match(/text-decoration-style:\s*wavy/g) || []).length, 3000);
  await page.reload();
  await page.waitForFunction((doc) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === doc, doc);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dockType}"]`).click();
  await waitCount(3000);
  await page.locator(".sya-search__input").fill("长文标注 2999");
  await page.waitForFunction(() => document.querySelector(".sya-card__text")?.textContent === "长文标注 2999");
  await page.screenshot({ path: "test-results/native-v3-reopened.png" });
  assert.deepEqual(errors.filter((e) => e.includes("sy-annotation")), []);
  await writeFile("test-results/native-v3.json", JSON.stringify({ doc, blocks: 10000, annotations: 3000, sourceInitiallyMounted: mounted, nativeBatchRequests: transactions, fullReadsDuringBatch: batchRootReads, fullReadsThroughReopen: rootReads, previewMs, commitMs, validationMs: savingStarted - commitStarted, errors }, null, 2));
  console.log(`Native 3.8.10 v0.3.1 passed: 10,000 blocks/3,000 marks; preview ${previewMs} ms, commit+verification ${commitMs} ms; live progress, unloaded blocks, one native transaction, single undo/redo, save/reopen and full search.`);
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: "test-results/native-v3-error.png" }); console.log((await page.locator(".sya-panel, .sya-replacement-dialog").allInnerTexts()).join("\n").slice(-1500)); }
  throw error;
} finally { await browser.close(); }
