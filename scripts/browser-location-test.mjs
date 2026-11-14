import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { startPreview } from "./preview.mjs";

const { server, url } = await startPreview(0);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "6");
  await page.evaluate(() => {
    const source = ['<div data-node-id="chapter" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">同一章节</div></div>'];
    for (let i = 0; i < 50; i++) source.push(`<div data-node-id="p${i}" data-type="NodeParagraph"><div contenteditable="true">${i === 40 ? '<span data-type="mark">重复文字</span>中间正文<span data-type="u">重复文字</span>' : i === 41 ? '无标注正文' : `<span data-type="mark">标注 ${i}</span>`}</div></div>`);
    window.annotationPreview.setVirtualDocument(source.join(""));
    // Most source blocks are unloaded; location must still use the complete index.
    document.querySelector("#wysiwyg").innerHTML = source[41];
  });
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "50" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  const caret = async (blockId, markIndex = 0, offset = 1) => {
    await page.evaluate(({ blockId, markIndex, offset }) => {
      const block = document.querySelector(`[data-node-id="${blockId}"]`);
      const content = block.querySelector('[contenteditable="true"]');
      const text = markIndex === "gap" ? content.childNodes[1] : content.querySelectorAll("span")[markIndex]?.firstChild ?? content.firstChild;
      content.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      const range = document.createRange(); range.setStart(text, offset); range.collapse(true); selection.addRange(range);
    }, { blockId, markIndex, offset });
  };
  await caret("p40", 1);
  await page.getByRole("button", { name: "折叠全部标题", exact: true }).click();
  await page.locator(".sya-locate").click();
  await page.waitForFunction(() => document.querySelector('.sya-card[aria-current="location"] .sya-card__sample')?.style.textDecorationLine === "underline");
  const key = await page.locator(".sya-card.is-current").getAttribute("data-annotation-key");
  assert.ok(await page.locator(".sya-card.is-current").evaluate((card) => {
    const bounds = card.getBoundingClientRect(), tree = card.closest(".sya-tree").getBoundingClientRect();
    return bounds.top >= tree.top - 1 && bounds.bottom <= tree.bottom + 1;
  }), "the exact card must scroll into view");
  await page.locator(".sya-locate").dblclick();
  await caret("p40", 0);
  await page.waitForFunction((key) => document.querySelector(".sya-card.is-current")?.dataset.annotationKey !== key, key);
  assert.equal(await page.locator(".sya-card.is-current").count(), 1);
  await caret("p40", 1);
  await page.waitForFunction((key) => document.querySelector(".sya-card.is-current")?.dataset.annotationKey === key, key);
  await caret("p40", "gap", 3);
  await page.waitForFunction(() => !document.querySelector('.sya-card.is-current, .sya-card[aria-current="location"]'));
  await page.locator(".sya-tree").evaluate((tree) => { tree.scrollTop = 0; });
  await page.locator(".sya-locate").click();
  assert.ok(await page.locator(`.sya-virtual-row`).evaluateAll((rows, key) => {
    const row = rows.find((row) => row.dataset.key === key);
    if (!row) return false;
    const rect = row.getBoundingClientRect(), bounds = row.closest(".sya-tree").getBoundingClientRect();
    return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  }, key), "an unmarked gap must still navigate to the nearby card");
  assert.equal(await page.locator(".sya-card.is-current, .sya-card[aria-current]").count(), 0,
    "nearby navigation must not select a card");
  await caret("p40", 1);
  await page.waitForFunction((key) => document.querySelector(".sya-card.is-current")?.dataset.annotationKey === key, key);
  await page.locator(".sya-locate").dblclick();
  await page.locator(".sya-style-filter").selectOption("yellow");
  await page.waitForFunction(() => !document.querySelector('.sya-tree[aria-busy="true"]'));
  await page.locator(".sya-locate").click();
  assert.match(await page.locator("#messages").textContent(), /清除筛选/);
  assert.equal(await page.locator(".sya-style-filter").inputValue(), "yellow");
  await page.locator(".sya-style-filter").selectOption("all");
  await page.evaluate(() => {
    const source = document.createElement("div"); source.innerHTML = window.annotationPreview.sourceDOM;
    document.querySelector("#wysiwyg").append(source.querySelector('[data-node-id="p41"]'));
  });
  await caret("p41");
  await page.locator(".sya-locate").click();
  assert.equal(await page.locator(".sya-card.is-current, .sya-card[aria-current]").count(), 0,
    "plain paragraphs cannot leave a nearby card selected");
  assert.ok(await page.locator(".sya-card").evaluateAll((cards) => cards.some((card) => {
    if (card.textContent !== "标注 42") return false;
    const rect = card.getBoundingClientRect(), bounds = card.closest(".sya-tree").getBoundingClientRect();
    return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  })), "plain paragraphs still jump to the nearest annotation");

  // Scroll within one multi-screen paragraph, without a heading or a new caret.
  await page.evaluate(() => {
    const html = '<div data-node-id="long" data-type="NodeParagraph"><div contenteditable="true"><span data-type="mark">段落开头</span>' + '很长的正文内容，用于滚动阅读。'.repeat(400) + '<span data-type="u">段落末尾</span></div></div>';
    window.annotationPreview.setVirtualDocument(html);
  });
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "2" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  await caret("long", 0);
  await page.locator(".sya-locate").click();
  assert.equal(await page.locator(".sya-card.is-current").textContent(), "段落开头");
  await page.evaluate(() => {
    const block = document.querySelector('[data-node-id="long"]');
    block.querySelectorAll("span")[1].scrollIntoView({ block: "center" });
    block.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 600 }));
  });
  const editorScroll = await page.locator("#preview-editor").evaluate((editor) => editor.scrollTop);
  await page.locator(".sya-locate").click();
  assert.equal(await page.locator(".sya-card.is-current, .sya-card[aria-current]").count(), 0,
    "scrolling over unmarked text must clear the selected card");
  assert.equal(await page.locator("#preview-editor").evaluate((editor) => editor.scrollTop), editorScroll, "locating must preserve the document reading position");
  await caret("long", 1);
  await page.locator(".sya-locate").click();
  await page.waitForFunction(() => document.querySelector(".sya-card.is-current")?.textContent === "段落末尾");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/current-position.png" });
  assert.deepEqual(errors, []);
  console.log("Current-position browser checks passed: exact offsets, repeated text, collapsed/unloaded cards, in-section follow, filtering, nearby navigation without selection and heading-free viewport reading.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
