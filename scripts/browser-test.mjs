import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";

const { server, url } = await startPreview(0);
await mkdir("test-results", { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const count = async (value) =>
    page.waitForFunction(
      (value) =>
        document.querySelector(".sya-document__count")?.textContent ===
          String(value) &&
        !document.querySelector('.sya-tree[aria-busy="true"]'),
      value,
    );
  await count(6);
  assert.equal(await page.locator(".sya-card__meta").count(), 0);
  const firstCard = await page
    .locator(".sya-card")
    .first()
    .evaluate((card) => ({
      foreground: card.style.getPropertyValue("--sya-mark-foreground"),
      background: card.style.getPropertyValue("--sya-mark-background"),
      gradient: getComputedStyle(card, "::before").backgroundImage,
      sampleBackground: getComputedStyle(
        card.querySelector(".sya-card__sample"),
      ).backgroundColor,
    }));
  assert.equal(firstCard.foreground, "#9aa0a6");
  assert.match(firstCard.background, /b3-protyle-inline-mark-background/);
  assert.match(firstCard.gradient, /linear-gradient/);
  assert.notEqual(firstCard.sampleBackground, "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: "test-results/preview-light.png" });
  await page.locator("#theme-toggle").click();
  await page.screenshot({ path: "test-results/preview-dark.png" });
  await page.locator("#theme-toggle").click();
  // Both toolbars keep overflow horizontal and hide native scrollbar tracks.
  await page.evaluate(() => {
    const plugin = window.annotationPreview.plugin;
    window.originalTools = plugin.config.tools;
    plugin.config.tools = Array.from({ length: 30 }, (_, index) => ({
      ...window.originalTools[index % window.originalTools.length],
      id: `overflow-${index}`,
      label: `溢出样式 ${index}`,
    }));
    plugin.updateTools();
    plugin.toggleToolbar();
  });
  for (const selector of [".sya-panel .sya-palette", ".sya-tools--floating .sya-palette"]) {
    const palette = page.locator(selector);
    const metrics = await palette.evaluate((node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollbar: getComputedStyle(node).scrollbarWidth,
      webkitScrollbar: getComputedStyle(node, "::-webkit-scrollbar").display,
      overflowY: getComputedStyle(node).overflowY,
    }));
    assert.ok(metrics.scrollWidth > metrics.width);
    assert.ok(metrics.scrollHeight <= metrics.height + 1);
    assert.equal(metrics.scrollbar, "none");
    assert.equal(metrics.webkitScrollbar, "none");
    assert.equal(metrics.overflowY, "hidden");
    await palette.hover();
    await page.mouse.wheel(0, 120);
    await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft >= 100, selector);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft === 0, selector);
    const box = await palette.boundingBox();
    const x = box.x + Math.min(box.width - 25, 150);
    const y = box.y + 18;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 90, y, { steps: 10 });
    await page.mouse.up();
    assert.ok(await palette.evaluate((node) => node.scrollLeft >= 80));
    assert.equal(await page.locator(".sya-editor-indicator").count(), 0, "drag must not activate a style");
    assert.equal(await page.evaluate(() => window.annotationPreview.transactions), 0);
  }
  await page.screenshot({ path: "test-results/overflow-toolbar.png" });
  await page.evaluate(() => {
    const plugin = window.annotationPreview.plugin;
    plugin.config.tools = window.originalTools;
    plugin.updateTools();
    plugin.toggleToolbar();
    for (const node of document.querySelectorAll(".sya-palette")) node.scrollLeft = 0;
    delete window.originalTools;
  });
  const initialReads = await page.evaluate(
    () => window.annotationPreview.fullReads,
  );
  await page.locator('.sya-panel [data-tool-id="yellow"]').click();
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0, "selecting a style must not begin painting");
  await page.locator(".sya-panel .sya-continuous").click();
  await page.locator(".sya-editor-indicator").waitFor();
  const drag = await page.evaluate(() => {
    const text = document.querySelector(
      '[data-node-id="20261113090006-paragra"] [contenteditable="true"]',
    ).firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 9);
    const rect = range.getBoundingClientRect();
    return {
      x1: rect.left + 1,
      x2: rect.right - 1,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.move(drag.x1, drag.y);
  await page.mouse.down();
  await page.mouse.move(drag.x2, drag.y, { steps: 12 });
  await page.mouse.up();
  await count(7);

  async function select(start, end, fire = true) {
    await page.evaluate(
      ({ start, end, fire }) => {
        const editable = document.querySelector(
          '[data-node-id="20261113090006-paragra"] [contenteditable="true"]',
        );
        editable.focus();
        const walker = document.createTreeWalker(
          editable,
          NodeFilter.SHOW_TEXT,
        );
        const range = document.createRange();
        let node;
        let offset = 0;
        let started = false;
        while ((node = walker.nextNode())) {
          if (!started && start < offset + node.length) {
            range.setStart(node, start - offset);
            started = true;
          }
          if (started && end <= offset + node.length) {
            range.setEnd(node, end - offset);
            break;
          }
          offset += node.length;
        }
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        if (fire)
          editable.dispatchEvent(
            new PointerEvent("pointerup", { button: 0, bubbles: true }),
          );
      },
      { start, end, fire },
    );
  }
  await page.keyboard.press("Escape");
  await select(12, 23, false);
  await page.locator('.sya-panel [data-tool-id="blue"]').click();
  assert.equal(await page.evaluate(() => window.annotationPreview.transactions), 1, "selecting a style must not apply to the selection");
  await page.locator(".sya-panel .sya-apply").click();
  await count(8);
  assert.equal(
    await page.evaluate(() => window.annotationPreview.transactions),
    2,
  );
  assert.equal(
    await page.evaluate(() => window.annotationPreview.fullReads),
    initialReads,
  );

  await page.locator(".sya-panel .sya-new-tool").click();
  assert.equal(await page.locator('[data-field="indicator"]').count(), 0);
  await page.locator(".sya-inherit-current").check();
  await page.waitForFunction(() =>
    document
      .querySelector(".sya-manager__error")
      ?.textContent.includes("已复制"),
  );
  await page.locator('[data-field="label"]').fill("继承的组合");
  await page.locator('[data-mark="strong"]').check();
  await page
    .locator('[data-field="text-decoration-style"]')
    .selectOption("wavy");
  await page.locator('[data-field="text-decoration-color"]').fill("#bb5566");
  await page.locator(".sya-save-tool").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".sya-manager__error")
      ?.textContent.includes("已保存"),
  );
  const custom = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tools.json")).tools.find(
      (tool) => tool.label === "继承的组合",
    ),
  );
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("tools.json")).tools.length,
    ),
    7,
  );
  assert.ok(
    Object.values(custom.styles).every(
      (value) => !String(value).includes("var("),
    ),
  );
  await page.screenshot({ path: "test-results/tool-settings.png" });
  await page.getByRole("button", { name: "关闭工具设置", exact: true }).click();
  await page.locator(`.sya-panel [data-tool-id="${custom.id}"]`).click();
  await page.locator(".sya-panel .sya-continuous").click();
  await select(30, 36);
  await count(9);
  assert.equal(
    await page.evaluate(() => window.annotationPreview.transactions),
    3,
  );
  const combo = await page
    .locator('[data-node-id="20261113090006-paragra"] [data-type~="strong"]')
    .evaluate((node) => ({
      text: node.textContent,
      wave: node.style.textDecorationStyle,
      background: node.style.backgroundColor,
    }));
  assert.equal(combo.wave, "wavy");
  assert.equal(combo.background, custom.styles["background-color"]);
  await select(30, 36);
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => window.annotationPreview.transactions),
    3,
    "repeat painting must be idempotent",
  );
  await page.evaluate(() => window.annotationPreview.undo());
  await count(8);
  assert.equal(
    await page
      .locator('[data-node-id="20261113090006-paragra"] [data-type~="strong"]')
      .count(),
    0,
  );
  await page.evaluate(() => window.annotationPreview.redo());
  await count(9);
  assert.equal(
    await page.evaluate(() => window.annotationPreview.fullReads),
    initialReads,
  );
  await page.screenshot({ path: "test-results/continuous-annotation.png" });

  const noteBeforeDeletion = await page.locator("#wysiwyg").innerHTML();
  await page
    .locator(`.sya-panel [data-tool-id="${custom.id}"]`)
    .click({ button: "right" });
  await page.getByRole("button", { name: "删除工具", exact: true }).click();
  await page.waitForFunction(
    (id) => !document.querySelector(`.sya-panel [data-tool-id="${id}"]`),
    custom.id,
  );
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  assert.equal(await page.locator("#wysiwyg").innerHTML(), noteBeforeDeletion);
  await page.locator(".sya-panel .sya-manage-tools").click();
  await page
    .getByRole("button", { name: "下移 黄色高亮", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("tools.json")).tools[0].id === "green",
  );
  await page.getByRole("button", { name: "关闭工具设置", exact: true }).click();
  await page.reload();
  await count(6);
  assert.equal(
    await page
      .locator(".sya-panel .sya-swatch")
      .first()
      .getAttribute("data-tool-id"),
    "green",
  );
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  const beforeInput = await page.evaluate(
    () => window.annotationPreview.transactions,
  );
  await page.locator('.sya-panel [data-tool-id="yellow"]').click();
  await page.locator(".sya-search__input").fill("问题");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.locator(".sya-panel .sya-apply").click();
  assert.equal(
    await page.evaluate(() => window.annotationPreview.transactions),
    beforeInput,
  );
  await page.locator(".sya-search__input").fill("");
  await page.locator(".sya-card").first().click();
  assert.match(
    await page.evaluate(() => window.getSelection().toString()),
    /真正的阅读/,
  );
  assert.equal(
    await page.evaluate(() => window.annotationPreview.transactions),
    beforeInput,
  );
  await page.keyboard.press("Escape");

  // All 10,000 paragraphs belong to the document index; only the current viewport is mounted in the dock.
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    const html = [];
    for (let i = 0; i < 10000; i++) {
      if (i % 100 === 0)
        html.push(
          `<div data-node-id="h${i}" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">章节 ${i / 100}</div></div>`,
        );
      html.push(
        `<div data-node-id="p${i}" data-type="NodeParagraph"><div contenteditable="true">${i % 10 < 3 ? `<span data-type="mark">标注 ${i}</span>` : `正文 ${i}`}</div></div>`,
      );
    }
    preview.protyle.block.rootID = "long-doc";
    preview.protyle.title.editElement.textContent = "长文压力测试：10,000 段";
    preview.protyle.wysiwyg.element.innerHTML = html.join("");
    preview.bus.emit("switch-protyle", { protyle: preview.protyle });
  });
  await count(3000);
  assert.ok((await page.locator(".sya-virtual-row").count()) < 100);
  const longReads = await page.evaluate(
    () => window.annotationPreview.fullReads,
  );
  await page.locator(".sya-tree").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sya-card__text")].some(
      (node) => node.textContent === "标注 9992",
    ),
  );
  await page.locator(".sya-search__input").fill("标注 9992");
  await page.waitForFunction(() => !document.querySelector('.sya-tree[aria-busy="true"]'));
  assert.equal(await page.locator(".sya-card").count(), 1);
  await page.evaluate(() => {
    const text = document.querySelector(
      '[data-node-id="p9001"] [contenteditable="true"]',
    ).firstChild;
    text.parentElement.focus();
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await page.locator(".sya-locate").click();
  assert.match(await page.locator("#messages").textContent(), /清除筛选/);
  assert.equal(
    await page.locator(".sya-search__input").inputValue(),
    "标注 9992",
  );
  await page.locator(".sya-search__input").fill("");
  await page.getByRole("button", { name: "折叠全部标题", exact: true }).click();
  await page.locator(".sya-locate").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".sya-heading.is-current")
      ?.textContent.includes("章节 90"),
  );
  await page.locator(".sya-locate").dblclick();
  assert.equal(
    await page.locator(".sya-locate").getAttribute("aria-pressed"),
    "true",
  );
  await page.evaluate(() => {
    const text = document.querySelector(
      '[data-node-id="p1001"] [contenteditable="true"]',
    ).firstChild;
    text.parentElement.focus();
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".sya-heading.is-current")
      ?.textContent.includes("章节 10"),
  );
  await page.screenshot({ path: "test-results/long-document.png" });
  await page.locator(".sya-locate").dblclick();
  assert.equal(
    await page.locator(".sya-locate").getAttribute("aria-pressed"),
    "false",
  );
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    const block = document.querySelector('[data-node-id="p9999"]');
    block.querySelector('[contenteditable="true"]').innerHTML =
      '<span data-type="mark">增量新增标注</span>';
    preview.bus.emit("ws-main", {
      cmd: "transactions",
      data: [
        {
          doOperations: [
            { action: "update", id: "p9999", data: block.outerHTML },
          ],
        },
      ],
    });
  });
  await count(3001);
  assert.equal(
    await page.evaluate(() => window.annotationPreview.fullReads),
    longReads,
  );
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    preview.bus.emit("ws-main", {
      cmd: "transactions",
      data: [
        {
          doOperations: [
            {
              action: "insert",
              id: "new-heading",
              parentID: "long-doc",
              previousID: "p9998",
              data: '<div data-node-id="new-heading" data-type="NodeHeading" data-subtype="h2"><div contenteditable="true">插入的增量标题</div></div>',
            },
          ],
        },
      ],
    });
  });
  await page.locator(".sya-search__input").fill("插入的增量标题");
  await page.waitForFunction(
    () =>
      document.querySelector(".sya-card__text")?.textContent === "增量新增标注",
  );
  await page.evaluate(() =>
    window.annotationPreview.bus.emit("ws-main", {
      cmd: "transactions",
      data: [{ doOperations: [{ action: "delete", id: "new-heading" }] }],
    }),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".sya-empty strong")?.textContent ===
      "没有匹配的标注",
  );
  assert.equal(
    await page.evaluate(() => window.annotationPreview.fullReads),
    longReads,
  );
  await page.locator(".sya-search__input").fill("");

  // Delayed obsolete snapshots must never overwrite a newly activated document.
  await page.evaluate(() => {
    const original = window.fetch;
    let first = true;
    window.fetch = async (input, init) => {
      if (input === "/api/block/getBlockDOM" && first) {
        first = false;
        const response = await original(input, init);
        return new Promise((resolve) => {
          window.releaseOldResponse = () => resolve(response);
        });
      }
      return original(input, init);
    };
    window.annotationPreview.bus.emit("ws-main", { cmd: "refresh" });
  });
  await page.waitForFunction(() => !!window.releaseOldResponse);
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    preview.protyle.block.rootID = "new-doc";
    preview.protyle.title.editElement.textContent = "另一篇文档";
    preview.protyle.wysiwyg.element.innerHTML =
      '<div data-node-id="new-paragraph" data-type="NodeParagraph"><div contenteditable="true"><span data-type="mark">仅属于新文档</span></div></div>';
    preview.bus.emit("switch-protyle", { protyle: preview.protyle });
    window.releaseOldResponse();
  });
  await count(1);
  assert.equal(
    await page.locator(".sya-card__text").textContent(),
    "仅属于新文档",
  );
  await page.locator(".sya-panel .sya-continuous").click();
  await page.evaluate(() => window.annotationPreview.plugin.onunload());
  assert.equal(
    await page
      .locator(
        ".sya-panel, .sya-editor-indicator, .sya-tools--floating, .sya-painting, .sya-manager",
      )
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: hidden-scrollbar wheel/drag on both toolbars without accidental painting, one-click painting, native combinations/undo, tool CRUD/import/order/persistence, 10,000 blocks + 3,000 annotations, virtualization, locate/follow, incremental edits/structure, stale responses, cleanup.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
