import { selectStyle } from "./style-picker-test-helpers.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";

const { server, url } = await startPreview(0);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "6" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  const tx = () => page.evaluate(() => window.annotationPreview.transactions);
  const select = (start, end, fire = true) => page.evaluate(({ start, end, fire }) => {
    const editable = document.querySelector('[data-node-id="20261113090006-paragra"] [contenteditable="true"]');
    editable.focus(); const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    const range = document.createRange(); let offset = 0; let started = false; let node;
    while ((node = walker.nextNode())) {
      if (!started && start < offset + node.length) { range.setStart(node, start - offset); started = true; }
      if (started && end <= offset + node.length) { range.setEnd(node, end - offset); break; }
      offset += node.length;
    }
    getSelection().removeAllRanges(); getSelection().addRange(range);
    if (fire) editable.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
  }, { start, end, fire });
  await selectStyle(page, ".sya-panel .sya-palette", "blue");
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  await select(0, 8);
  await selectStyle(page, ".sya-panel .sya-palette", "yellow");
  assert.equal(await tx(), 0, "style selection never paints an existing range");
  await page.locator(".sya-panel .sya-apply").click();
  assert.equal(await tx(), 1);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  await page.locator(".sya-panel .sya-apply").click();
  await page.locator(".sya-editor-indicator").waitFor();
  assert.match(await page.locator(".sya-editor-indicator strong").textContent(), /一处/);
  const cursor = await page.locator('[data-node-id="20261113090006-paragra"] [contenteditable="true"]').evaluate((n) => getComputedStyle(n).cursor);
  assert.match(cursor, /9 16, text$/);
  const cursorURL = /^url\("(.*?)"\)/.exec(cursor)[1];
  const svg = decodeURIComponent(cursorURL.split(",").slice(1).join(","));
  assert.match(svg, /M5 4h8M9 4v24M5 28h8/, "I-beam cursor plus a brush");
  await page.evaluate((src) => {
    const img = document.createElement("img"); img.src = src; img.alt = "I 形文本光标和刷子";
    img.style.cssText = "position:fixed;left:550px;top:500px;width:64px;height:64px;z-index:10000;background:#eee;border-radius:5px;padding:4px";
    img.id = "cursor-sample"; document.body.append(img);
  }, cursorURL);
  await page.screenshot({ path: "test-results/single-annotation-cursor.png" });
  await page.locator("#cursor-sample").evaluate((n) => n.remove());
  await select(9, 17);
  await page.waitForFunction(() => window.annotationPreview.transactions === 2);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  await select(20, 26); await page.waitForTimeout(60);
  assert.equal(await tx(), 2, "one-shot stops after one valid range");
  await page.keyboard.press("ArrowRight");
  await page.locator(".sya-panel .sya-apply").click();
  await page.locator(".sya-editor-indicator").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sya-painting").count(), 0);
  await select(28, 32); await page.waitForTimeout(60); assert.equal(await tx(), 2);
  const preservedSelection = await page.evaluate(() => getSelection().toString());
  await page.locator(".sya-show-toolbar").click();
  await page.locator(".sya-tools--floating").waitFor();
  assert.equal(await page.evaluate(() => getSelection().toString()), preservedSelection);
  await page.locator(".sya-show-toolbar").click();
  assert.equal(await page.locator(".sya-tools--floating").count(), 1);
  await page.locator(".sya-panel .sya-continuous").click();
  await select(30, 36); await page.waitForFunction(() => window.annotationPreview.transactions === 3);
  await selectStyle(page, ".sya-panel .sya-palette", "blue");
  assert.equal(await tx(), 3);
  await select(40, 46); await page.waitForFunction(() => window.annotationPreview.transactions === 4);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);

  // Observe genuine progress during a delayed native transaction; no invented completion.
  await page.evaluate(() => {
    getSelection().removeAllRanges();
    const preview = window.annotationPreview; const html = [];
    for (let i = 0; i < 10000; i++) html.push(`<div data-node-id="p${i}" data-type="NodeParagraph"><div contenteditable="true">${i < 3000 ? `<span data-type="mark">标注 ${i}</span>` : `正文 ${i}`}</div></div>`);
    preview.setVirtualDocument(html.join(""));
    const getInstance = preview.protyle.getInstance;
    const instance = getInstance(); let finish;
    preview.protyle.getInstance = () => ({ ...instance,
      transaction(...args) { finish = new Promise((resolve) => setTimeout(() => { instance.transaction(...args); resolve(); }, 4000)); },
      async flushPendingTransactions() { if (finish) { await finish; finish = undefined; } },
    });
  });
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "3000" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  const blockReads = await page.evaluate(() => window.annotationPreview.blockReadBatches);
  await page.locator(".sya-open-bulk").click();
  // Native mark matches its actual background, which may differ from a user preset.
  await page.locator(".sya-batch-source-kind").selectOption("signature");
  const sourceValue = await page.locator(".sya-batch-source option").nth(1).getAttribute("value");
  await page.locator(".sya-batch-source").selectOption(sourceValue);
  await selectStyle(page, ".sya-batch-target", "wave");
  await page.waitForFunction(() => document.querySelector(".sya-batch-execute")?.textContent === "修改 3000 处" && !document.querySelector(".sya-batch-execute").disabled);
  const beforeCommitSnapshots = await page.evaluate(() => window.annotationPreview.fullReads);
  await page.locator(".sya-batch-execute").click();
  await page.locator('.sya-batch-progress[data-phase="saving"]').waitFor();
  assert.equal(await page.locator(".sya-batch-progress-bar").getAttribute("value"), null);
  assert.match(await page.locator(".sya-batch-count").textContent(), /已完成 0 \/ 3,000/);
  await page.waitForFunction(() => /思源处理中 [1-9]/.test(document.querySelector(".sya-batch-elapsed")?.textContent || ""));
  assert.match(await page.locator(".sya-batch-elapsed").textContent(), /思源处理中 [1-9]/);
  assert.equal(await page.getByRole("button", { name: "取消批量修改", exact: true }).isDisabled(), true);
  await page.screenshot({ path: "test-results/batch-live-progress.png" });
  await page.locator(".sya-replacement-dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.annotationPreview.blockReadBatches), blockReads, "large jobs never reload the source tree for each individual block");
  assert.equal(await page.evaluate(() => window.annotationPreview.fullReads) - beforeCommitSnapshots, 2, "one validation snapshot and one saved-result snapshot");
  assert.equal(await page.evaluate(() => (window.annotationPreview.sourceDOM.match(/wavy/g) || []).length), 3000);
  assert.deepEqual(errors, []);
  console.log("v0.3.1 passed: select-only tools, immediate/one-shot annotation, Esc, explicit continuous mode, sidebar toolbar, I-beam+brush cursor, snapshot bulk optimization, accurate counts and live saving timer.");
} catch (error) { await browser.contexts()[0]?.pages()[0]?.screenshot({ path: "test-results/v31-error.png" }); throw error; }
finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
