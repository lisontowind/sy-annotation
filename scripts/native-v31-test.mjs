import { selectStyle } from "./style-picker-test-helpers.mjs";
import { chromium } from "playwright";
import { cp } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:6917";
async function api(route, body = {}) {
  const result = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(result.code, 0, result.msg); return result.data;
}
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
const active = (await api("/api/system/getWorkspaces")).filter((w) => !w.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace);
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find((n) => n.name === "Annotation v0.2 QA");
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/v031-once-${Date.now()}`, markdown: "# 单次标注\n\n第一段用于验证选中之后点击标注。\n\n第二段用于验证只标注下一次选区。" });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction((id) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === id, doc);
  const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "0" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  const select = (paragraph, start, end) => page.evaluate(({ paragraph, start, end }) => {
    const plugin = window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation");
    const editable = plugin.active.wysiwyg.element.querySelectorAll('[data-type="NodeParagraph"] [contenteditable="true"]')[paragraph];
    editable.focus(); const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    const range = document.createRange(); let node; let offset = 0; let started = false;
    while ((node = walker.nextNode())) {
      if (!started && start < offset + node.length) { range.setStart(node, start - offset); started = true; }
      if (started && end <= offset + node.length) { range.setEnd(node, end - offset); break; }
      offset += node.length;
    }
    getSelection().removeAllRanges(); getSelection().addRange(range); editable.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
  }, { paragraph, start, end });
  const flush = () => page.evaluate(() => window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").active.getInstance().flushPendingTransactions());
  await select(0, 0, 4);
  await selectStyle(page, ".sya-panel .sya-palette", "blue");
  await flush(); assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  assert.doesNotMatch((await api("/api/block/getBlockDOM", { id: doc })).dom, /background-color/);
  await page.locator(".sya-panel .sya-apply").click();
  await flush();
  assert.match((await api("/api/block/getBlockDOM", { id: doc })).dom, /background-color/);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  await page.locator(".sya-panel .sya-apply").click();
  await page.locator(".sya-editor-indicator").waitFor();
  assert.match(await page.locator(".sya-editor-indicator strong").textContent(), /一处/);
  const cursor = await page.locator('.protyle-wysiwyg [contenteditable="true"]').first().evaluate((n) => getComputedStyle(n).cursor);
  assert.match(cursor, /9 16, text$/);
  await select(1, 0, 4);
  await page.waitForFunction(() => !document.querySelector(".sya-editor-indicator")); await flush();
  const before = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((before.match(/background-color/g) || []).length, 2);
  await select(1, 0, 2); await flush();
  assert.equal((await api("/api/block/getBlockDOM", { id: doc })).dom, before);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator(".sya-panel .sya-apply").click(); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sya-painting").count(), 0);
  const browserNotice = page.locator('#message .b3-snackbar__content--close').filter({ hasText: "仅支持在 Chrome" });
  if (await browserNotice.isVisible()) await browserNotice.click();
  await page.locator(".sya-show-toolbar").click();
  assert.equal(await page.locator(".sya-tools--floating").count(), 1);
  await page.screenshot({ path: "test-results/native-once-annotation.png" });
  console.log("Native v0.3.1 interaction passed: select-only style, immediate selection annotation, one next-selection annotation, no further automatic writes, Esc, sidebar toolbar and I-beam+brush cursor.");
} finally { await browser.close(); }
