import { selectStyle } from "./style-picker-test-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/** Capture actual plugin interactions in an isolated local preview, in either language. */
export async function captureDemo(browser, url, directory, locale = "zh-CN", verify = false) {
  await mkdir(directory, { recursive: true });
  const en = locale === "en-US";
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  page.setDefaultTimeout(20000);
  try {
    await page.goto(`${url}/?lang=${locale}`);
    const ready = n => page.waitForFunction(n => document.querySelector(".sya-document__count")?.textContent === String(n) && !document.querySelector('.sya-tree[aria-busy="true"]'), n);
    const englishUI = async selector => {
      if (!en) return;
      const strings = await page.locator(selector).evaluateAll(nodes => nodes.flatMap(node => [node.textContent, ...[...node.querySelectorAll("[aria-label],[title],[placeholder]")].flatMap(el => [el.getAttribute("aria-label"),el.getAttribute("title"),el.getAttribute("placeholder")])]).filter(Boolean));
      assert.ok(strings.every(s => !/[\u4e00-\u9fff]/.test(s)), `Untranslated UI: ${strings.filter(s => /[\u4e00-\u9fff]/.test(s)).join(" | ")}`);
    };
    await ready(6);
    await page.addStyleTag({ content: ".preview-document{width:calc(100% - 90px);margin:30px auto 65px}.preview-kicker{font-size:10px}#document-title{font-size:26px}.preview-rule{margin:20px 0}.protyle-wysiwyg{font-size:15px;line-height:1.95}[data-type=NodeHeading][data-subtype=h1]{margin-top:26px}.preview-topbar{height:46px}.preview-layout{height:calc(100vh - 70px)}" });
    const shot = name => page.screenshot({ path: `${directory}/interface-${name}.png` });
    await englishUI(".sya-panel");
    const overview = await shot("light");
    const sidebar = await page.locator("#dock").screenshot({ path: `${directory}/sidebar.png` });
    await page.locator("#theme-toggle").click(); const dark = await shot("dark"); await page.locator("#theme-toggle").click();
    await selectStyle(page, ".sya-panel .sya-palette", "green");
    await page.locator(".sya-panel .sya-continuous").click();
    await page.locator(".sya-editor-indicator").waitFor();
    const drag = await page.evaluate(() => {
      const node = document.querySelector('[data-node-id="20261113090006-paragra"] [contenteditable]').firstChild;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 17);
      const rect = range.getBoundingClientRect(); return { x1: rect.left + 1, x2: rect.right - 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(drag.x1, drag.y); await page.mouse.down(); await page.mouse.move(drag.x2, drag.y, { steps: 12 }); await page.mouse.up();
    await ready(7); await englishUI(".sya-panel,.sya-editor-indicator,.sya-tools--floating");
    const annotate = await shot("annotate");
    await page.keyboard.press("Escape");
    await page.locator(".sya-search__input").fill(en ? "question" : "问题");
    await page.waitForFunction(() => !document.querySelector('.sya-tree[aria-busy="true"]') && document.querySelectorAll(".sya-card").length > 0 && document.querySelectorAll(".sya-card").length < 7);
    const search = await shot("search");
    await page.locator(".sya-search__input").fill(""); await ready(7);
    // A taller demo window keeps the batch preview examples visible below English help text.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator(".sya-more-filters").click();
    const root = page.locator(".sya-filter-dialog .sya-rule-group").first();
    await root.locator(":scope > .sya-rule-actions .sya-add-group").click();
    let nested = root.locator(":scope > .sya-rule-group");
    await nested.locator(":scope > .sya-rule-actions .sya-rule-op").selectOption("or");
    for (const tool of ["yellow", "green"]) {
      await nested.locator(":scope > .sya-rule-actions .sya-add-condition").click();
      nested = root.locator(":scope > .sya-rule-group");
      await nested.locator(":scope > .sya-rule-condition").last().locator(".sya-rule-field").selectOption("tool");
      await nested.locator(":scope > .sya-rule-condition").last().locator(".sya-rule-value").selectOption(tool);
    }
    await page.waitForFunction(text => document.querySelector(".sya-filter-dialog .sya-dialog-status")?.textContent === text, en ? "4 annotations matched" : "命中 4 处标注");
    await englishUI(".sya-filter-dialog");
    const filter = await page.locator(".sya-filter-dialog").screenshot({ path: `${directory}/dialog-filter.png` });
    await page.getByRole("button", { name: en ? "Cancel filters" : "取消筛选", exact: true }).click();
    await page.locator(".sya-open-bulk").click(); await selectStyle(page, ".sya-batch-target", "blue");
    await page.waitForFunction(() => !document.querySelector(".sya-batch-execute").disabled);
    assert.equal(await page.locator(".sya-batch-execute").textContent(), en ? "Change 1" : "修改 1 处");
    await englishUI(".sya-replacement-dialog");
    const batch = await page.locator(".sya-replacement-dialog").screenshot({ path: `${directory}/dialog-batch.png` });
    if (verify) {
      await page.locator(".sya-batch-execute").click();
      await page.locator(".sya-replacement-dialog").waitFor({ state: "detached" });
      await ready(7);
      assert.match(await page.locator("#messages").textContent(), /Changed 1 annotations/);
      await page.evaluate(() => window.annotationPreview.undo()); await ready(7);
    } else await page.getByRole("button", { name: en ? "Cancel batch restyle" : "取消批量修改", exact: true }).click();
    if (verify) {
      await page.evaluate(() => {
        const sample = document.querySelector('#wysiwyg [data-type~="mark"]');
        sample.closest('[contenteditable="true"]').focus();
        const range = document.createRange(); range.selectNodeContents(sample);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      });
      await page.locator(".sya-panel .sya-palette summary").click();
      await page.locator(".sya-panel .sya-new-combination").click();
      await page.locator(".sya-manager").waitFor();
      await englishUI(".sya-manager");
      assert.equal(await page.locator('[data-field="label"]').inputValue(), "New combination style");
      assert.equal(await page.locator('[data-mark="mark"]').isChecked(), true);
      await page.getByRole("button", { name: "Close tool settings", exact: true }).click();
    }
    await page.locator(".sya-panel .sya-palette summary").click();
    await page.locator(".sya-panel .sya-manage-tools").click();
    await englishUI(".sya-manager");
    const tools = await page.locator(".sya-manager").screenshot({ path: `${directory}/dialog-tools.png` });
    if (verify) {
      assert.equal(await page.locator('[data-field="label"]').inputValue(), "Yellow highlight");
      await page.locator('[data-mark="strong"]').check();
      await page.locator(".sya-save-tool").click();
      await page.waitForFunction(() => document.querySelector(".sya-manager__error")?.textContent === "Saved. Existing annotations remain unchanged.");
      assert.equal(await page.evaluate(() => window.annotationPreview.plugin.config.tools[0].label), "黄色高亮");
      await page.locator('[data-field="label"]').fill("My custom style"); await page.locator(".sya-save-tool").click();
      await page.waitForFunction(() => window.annotationPreview.plugin.config.tools[0].label === "My custom style");
      await page.getByRole("button", { name: "Close tool settings", exact: true }).click();
      // Check the actual source-language switch does not translate saved user labels.
      await page.goto(`${url}/?lang=zh-CN`); await ready(6);
      assert.equal(await page.locator('.sya-palette .sya-swatch[data-tool-id="yellow"]').getAttribute("aria-label"), "My custom style");
    }
    assert.deepEqual(errors, []);
    return { overview, sidebar, dark, annotate, search, filter, batch, tools };
  } finally { await page.close(); }
}
