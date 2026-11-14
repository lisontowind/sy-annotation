import { chromium } from "playwright";
import { cp } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { selectStyle } from "./style-picker-test-helpers.mjs";

const base = "http://127.0.0.1:6917";
async function api(route, body = {}) {
  const response = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(response.code, 0, `${route}: ${response.msg}`); return response.data;
}
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
const active = (await api("/api/system/getWorkspaces")).filter(item => !item.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace, "Only the isolated acceptance workspace may be modified");
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(item => item.name === "Annotation v0.2 QA");
assert.ok(notebook);
const texts = ["恢复全部配色", "仅恢复文字色", "仅恢复背景色"];
const span = (text, marks) => `<span data-type="${marks} text" style="color:#112233;background-color:#fce4a0"${marks.includes("a") ? ' data-href="https://example.test/default"' : ""}>${text}</span>`;
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/native-color-controls-${Date.now()}`, markdown: texts.map((text, index) => span(text, ["a strong u", "strong", "em"][index])).join("\n\n") });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
let page, originalConfig;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => { if (error.stack?.includes("sy-annotation")) errors.push(error.message); });
  let transactions = 0, colorWrites = 0;
  page.on("request", request => {
    // SiYuan records title caret visibility on focus changes; count annotation writes separately.
    if (request.url().endsWith("/api/transactions") && request.postDataJSON().transactions?.some(tx => tx.doOperations?.some(op => op.action !== "setDocTitle"))) transactions++;
    if (request.url().endsWith("/api/storage/setInlineStyles")) colorWrites++;
  });
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction(doc => window.siyuan?.ws?.app?.plugins?.find(plugin => plugin.name === "sy-annotation")?.rootId === doc, doc);
  const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "3" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  originalConfig = await page.evaluate(() => structuredClone(window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").config));
  await page.evaluate(() => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").active.getInstance().flushPendingTransactions());
  const initialTransactions = transactions, initialColorWrites = colorWrites;
  const notice = page.locator('#message .b3-snackbar__content--close').filter({ hasText: "仅支持在 Chrome" });
  if (await notice.isVisible()) await notice.click();
  const native = page.locator('.b3-dialog--open:not([data-key="dialog-setting"])');
  const manage = async (picker, group) => {
    await picker.locator(":scope > summary").click();
    assert.equal(await picker.locator(`[data-style-group="${group}"] [data-tool-id]`).first().getAttribute("data-tool-id"), `native:${group}:default`);
    await picker.locator(`.sya-manage-native-colors[data-native-style-group="${group}"]`).click();
    await native.waitFor({ state: "attached" });
    await native.locator(".b3-dialog__container").waitFor();
    await page.screenshot({ path: `test-results/native-color-manager-${group}.png` });
    await native.getByRole("button", { name: "取消", exact: true }).click();
    await native.waitFor({ state: "detached" });
    await page.waitForFunction(() => !window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").nativeColorManager.controller);
  };
  for (const group of ["style1", "color", "backgroundColor"]) await manage(page.locator(".sya-panel .sya-palette .sya-style-picker"), group);
  await page.locator(".sya-more-filters").click(); await page.locator(".sya-add-condition").first().click();
  await selectStyle(page, ".sya-rule-value", "native:color:1");
  await manage(page.locator(".sya-rule-value"), "color");
  await page.locator(".sya-filter-dialog").waitFor();
  assert.equal(await page.locator(".sya-rule-value").getAttribute("data-value"), "native:color:1", "opening native settings preserves the filter draft");
  await page.getByRole("button", { name: "关闭筛选面板", exact: true }).click();
  await page.locator(".sya-open-bulk").click(); await selectStyle(page, ".sya-batch-target", "wave");
  await page.locator(".sya-batch-mode").selectOption("preserve");
  await manage(page.locator(".sya-batch-target"), "backgroundColor");
  await page.locator(".sya-replacement-dialog").waitFor();
  assert.equal(await page.locator(".sya-batch-target").getAttribute("data-value"), "wave"); assert.equal(await page.locator(".sya-batch-mode").inputValue(), "preserve");
  await page.getByRole("button", { name: "关闭批量修改", exact: true }).click();
  assert.equal(transactions, initialTransactions, "opening native managers does not change annotations");
  assert.equal(colorWrites, initialColorWrites, "opening and canceling native managers never writes colors");
  const properties = text => page.evaluate(text => {
    const plugin = window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation");
    const walker = document.createTreeWalker(plugin.active.wysiwyg.element, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) if (node.textContent === text) {
      const result = { color: "", background: "", marks: [], href: "" };
      for (let parent = node.parentElement; parent && parent.contentEditable !== "true"; parent = parent.parentElement) {
        result.color ||= parent.style.color; result.background ||= parent.style.backgroundColor;
        result.marks.push(...(parent.dataset.type || "").split(" ")); result.href ||= parent.dataset.href || "";
      }
      return result;
    }
    throw new Error(`Missing fixture text: ${text}`);
  }, text);
  for (const [index, group] of ["style1", "color", "backgroundColor"].entries()) {
    await selectStyle(page, ".sya-panel .sya-palette", `native:${group}:default`);
    const before = await properties(texts[index]);
    assert.ok(before.color && before.background, "the fixture starts with both authored colors");
    if (index === 0) { assert.equal(before.href, "https://example.test/default"); assert.ok(before.marks.includes("strong") && before.marks.includes("u")); }
    await page.evaluate(text => {
      const plugin = window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation");
      const walker = document.createTreeWalker(plugin.active.wysiwyg.element, NodeFilter.SHOW_TEXT); let node;
      while ((node = walker.nextNode())) if (node.textContent === text) {
        node.parentElement.closest('[contenteditable="true"]').focus();
        const range = document.createRange(); range.selectNodeContents(node);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        node.parentElement.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })); return;
      }
    }, texts[index]);
    const count = transactions;
    await page.locator(".sya-panel .sya-apply").click();
    await page.evaluate(() => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").active.getInstance().flushPendingTransactions());
    const after = await properties(texts[index]);
    assert.equal(after.color, group === "backgroundColor" ? before.color : "");
    assert.equal(after.background, group === "color" ? before.background : "");
    for (const mark of ["a", "strong", "em", "u"].filter(mark => before.marks.includes(mark))) assert.ok(after.marks.includes(mark), `${group} preserves ${mark}`);
    assert.equal(after.href, before.href); assert.equal(transactions, count + 1, "each native default is one transaction");
  }
  await page.screenshot({ path: "test-results/native-default-colors.png" }); assert.deepEqual(errors, []);
  console.log("Native color controls passed: direct native managers for all groups, preserved filter/batch drafts, three defaults, preserved typography/links and one transaction per reset.");
} finally {
  if (page && originalConfig) await page.evaluate(async config => { const plugin = window.siyuan?.ws?.app?.plugins?.find(plugin => plugin.name === "sy-annotation"); if (plugin) { plugin.config = config; await plugin.persist(); } }, originalConfig).catch(() => {});
  await browser.close();
}
