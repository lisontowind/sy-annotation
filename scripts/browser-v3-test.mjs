import { selectStyle } from "./style-picker-test-helpers.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";

const { server, url } = await startPreview(0);
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const ready = async (n) => page.waitForFunction((n) => document.querySelector(".sya-document__count")?.textContent === String(n) && !document.querySelector('.sya-tree[aria-busy="true"]'), n);
  await ready(6);
  await page.locator(".sya-manage-tools").click();
  const listStrip = await page.locator(".sya-manager__select").first().evaluate((node) => getComputedStyle(node, "::before").backgroundImage);
  assert.match(listStrip, /linear-gradient/);
  await selectStyle(page, '[data-color-property="color"]', "native:color:1");
  assert.equal(await page.locator(".sya-manager__tool.is-selected .sya-manager__select").evaluate(node => node.style.getPropertyValue("--sya-mark-foreground")), "var(--b3-font-color1)");
  await page.getByRole("button", { name: "关闭工具设置", exact: true }).click();
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    preview.protyle.block.rootID = "v3-doc";
    preview.protyle.title.editElement.textContent = "组合筛选与替换验收";
    const p = (id, body) => `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${body}</div></div>`;
    const h = (id, text) => `<div data-node-id="${id}" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">${text}</div></div>`;
    preview.protyle.wysiwyg.element.innerHTML = h("chapter1", "第一章") +
      p("a", '<span data-type="strong text" style="background-color:var(--b3-font-background12)">黄色加粗</span>') +
      p("b", '<span data-type="u text" style="background-color:var(--b3-font-background12);text-decoration-style:wavy">黄色波浪</span>') +
      h("chapter2", "第二章") + p("c", '<span data-type="text" style="background-color:var(--b3-font-background3)">蓝色原文</span>') +
      p("d", '<span data-type="text" style="background-color:var(--b3-font-background12)">筛选目标</span>');
    preview.bus.emit("switch-protyle", { protyle: preview.protyle });
  });
  await ready(4);
  await selectStyle(page, ".sya-style-filter", "yellow");
  await page.waitForFunction(() => document.querySelector(".sya-tree-label")?.textContent.includes("找到 3 处"));
  await selectStyle(page, ".sya-style-filter", "all");
  await page.locator(".sya-more-filters").click();
  const root = page.locator(".sya-filter-dialog .sya-rule-group").first();
  await root.locator(":scope > .sya-rule-actions .sya-add-group").click();
  const nested = root.locator(":scope > .sya-rule-group");
  await nested.locator(":scope > .sya-rule-actions .sya-rule-op").selectOption("or");
  for (const tool of ["yellow", "blue"]) {
    await nested.locator(":scope > .sya-rule-actions .sya-add-condition").click();
    const row = nested.locator(":scope > .sya-rule-condition").last();
    await row.locator(".sya-rule-field").selectOption("tool");
    await row.locator(".sya-rule-value").selectOption(tool);
  }
  await root.locator(":scope > .sya-rule-actions .sya-add-condition").click();
  const condition = root.locator(":scope > .sya-rule-condition");
  await condition.locator(".sya-rule-field").selectOption("strong");
  assert.equal(await page.locator(".sya-filter-apply").isDisabled(), true);
  await condition.locator(".sya-rule-comparison").selectOption("exclude");
  await condition.locator(".sya-rule-value").selectOption("yes");
  await page.waitForFunction(() => document.querySelector(".sya-filter-dialog .sya-dialog-status")?.textContent === "命中 3 处标注");
  await page.screenshot({ path: "test-results/filter-rules-v3.png" });
  await page.locator(".sya-filter-apply").click();
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 3);
  assert.match(await page.locator(".sya-more-filters").textContent(), /3/);
  await page.locator(".sya-more-filters").click();
  await page.getByRole("button", { name: "清空筛选规则", exact: true }).click();
  await page.locator(".sya-filter-apply").click();
  await ready(4);
  const transactions = () => page.evaluate(() => window.annotationPreview.transactions);
  const card = (text) => page.locator(".sya-card").filter({ hasText: text });
  await card("黄色加粗").click({ button: "right" });
  await page.locator(".sya-replace-mode").selectOption("preserve");
  await page.locator('.sya-replace-tool[data-tool-id="blue"]').click();
  await page.waitForFunction(() => document.querySelector('[data-node-id="a"] [data-type~="strong"]')?.getAttribute("style")?.includes("background3"));
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  await ready(4);
  await card("黄色加粗").click({ button: "right" });
  assert.equal(await page.locator(".sya-replace-mode").inputValue(), "preserve");
  await page.locator(".sya-replace-mode").selectOption("replace");
  await page.locator('.sya-replace-tool[data-tool-id="yellow"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-node-id="a"] [data-type~="strong"]'));
  await ready(4);
  const noOpBefore = await transactions();
  await card("黄色加粗").click({ button: "right" });
  await page.locator('.sya-replace-tool[data-tool-id="yellow"]').click();
  await page.waitForTimeout(180); assert.equal(await transactions(), noOpBefore);

  await page.locator(".sya-search__input").fill("筛选目标");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 1);
  await page.locator(".sya-open-bulk").click();
  await selectStyle(page, ".sya-batch-target", "wave");
  await page.locator(".sya-batch-scope").selectOption("filtered");
  await page.waitForFunction(() => document.querySelector(".sya-batch-execute")?.textContent === "修改 1 处" && !document.querySelector(".sya-batch-execute").disabled);
  await page.screenshot({ path: "test-results/bulk-preview-v3.png" });
  const beforeBatch = await transactions();
  await page.locator(".sya-batch-execute").click();
  await page.locator(".sya-replacement-dialog").waitFor({ state: "detached" });
  assert.equal(await transactions(), beforeBatch + 1);
  assert.match(await page.locator('[data-node-id="d"]').innerHTML(), /wavy/);
  assert.doesNotMatch(await page.locator('[data-node-id="a"]').innerHTML(), /wavy/);
  await page.evaluate(() => window.annotationPreview.undo());
  await page.waitForFunction(() => !document.querySelector('[data-node-id="d"] [style*="wavy"]'));
  await ready(4);
  await page.locator(".sya-search__input").fill("");

  // Invalidate a prepared batch if the source changes; no write is allowed.
  await page.locator(".sya-open-bulk").click();
  await selectStyle(page, ".sya-batch-target", "blue");
  await page.waitForFunction(() => !document.querySelector(".sya-batch-execute").disabled);
  const beforeStale = await transactions();
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    const block = document.querySelector('[data-node-id="a"]');
    block.querySelector('[contenteditable="true"]').append("外部编辑");
    preview.bus.emit("ws-main", { cmd: "transactions", data: [{ doOperations: [{ action: "update", id: "a", data: block.outerHTML }] }] });
  });
  await ready(4);
  await page.locator(".sya-batch-execute").click();
  await page.locator(".sya-batch-retry").waitFor();
  assert.equal(await transactions(), beforeStale);
  await page.getByRole("button", { name: "取消批量修改", exact: true }).click();

  // Full index with only twelve source blocks mounted: all 3,000 marks must still change.
  await page.evaluate(() => {
    const chunks = [];
    for (let i = 0; i < 10000; i++) {
      if (i % 100 === 0) chunks.push(`<div data-node-id="h${i}" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">章节 ${i / 100}</div></div>`);
      chunks.push(`<div data-node-id="p${i}" data-type="NodeParagraph"><div contenteditable="true">${i < 3000 ? `<span data-type="text" style="background-color:var(--b3-font-background12)">长文标注 ${i}</span>` : `正文 ${i}`}</div></div>`);
    }
    window.annotationPreview.setVirtualDocument(chunks.join(""));
  });
  await ready(3000);
  assert.ok(await page.locator(".protyle-wysiwyg [data-node-id]").count() < 20);
  const reads = await page.evaluate(() => window.annotationPreview.fullReads);
  await page.locator(".sya-open-bulk").click();
  await selectStyle(page, ".sya-batch-target", "wave");
  await page.waitForFunction(() => document.querySelector(".sya-batch-execute")?.textContent === "修改 3000 处" && !document.querySelector(".sya-batch-execute").disabled, null, { timeout: 120000 });
  const beforeLong = await transactions();
  await page.locator(".sya-batch-execute").click();
  await page.locator(".sya-replacement-dialog").waitFor({ state: "detached", timeout: 120000 });
  await ready(3000);
  assert.equal(await transactions(), beforeLong + 1);
  assert.equal(await page.evaluate(() => (window.annotationPreview.sourceDOM.match(/text-decoration-style: wavy/g) || []).length), 3000);
  assert.ok(await page.locator(".sya-card").count() < 50);
  assert.ok(await page.locator(".protyle-wysiwyg [data-node-id]").count() < 20);
  assert.equal(await page.evaluate(() => window.annotationPreview.fullReads), reads + 3, "large bulk uses one document snapshot per phase");
  await page.evaluate(() => window.annotationPreview.undo());
  await ready(3000);
  assert.equal(await page.evaluate(() => (window.annotationPreview.sourceDOM.match(/text-decoration-style: wavy/g) || []).length), 0);
  await page.evaluate(() => window.annotationPreview.redo());
  await ready(3000);
  assert.equal(await page.evaluate(() => (window.annotationPreview.sourceDOM.match(/text-decoration-style: wavy/g) || []).length), 3000);
  await page.locator(".sya-search__input").fill("长文标注 2999");
  await page.waitForFunction(() => document.querySelector(".sya-card__text")?.textContent === "长文标注 2999");
  await page.screenshot({ path: "test-results/long-replacement-v3.png" });
  assert.deepEqual(errors, []);
  console.log("v0.3 browser passed: live gradient, nested filters, exclusions, quick tool subsets, exact/preserve card replacement, no-op, scoped bulk + one undo, stale-preview rejection, 10,000 blocks/3,000 marks with unloaded source blocks, incremental updates.");
} catch (error) {
  if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: "test-results/v3-error.png" }); console.log((await page.locator("body").innerText()).slice(-2800)); } }
  throw error;
} finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
