import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";

const { server, url } = await startPreview(0);
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await page.waitForSelector(".sya-card");
  await page.evaluate(() => {
    const preview = window.annotationPreview;
    preview.protyle.block.rootID = "inline-formatting-doc";
    const p = (id, body) => `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${body}</div></div>`;
    preview.protyle.wysiwyg.element.innerHTML =
      p("mixed", '<span data-type="mark">前文<span data-type="sup a" data-href="https://example.test" data-title="链接">关键</span><span data-type="sub block-ref inline-memo" data-id="ref" data-subtype="d" data-inline-memo-content="说明">词</span>后文</span>') +
      p("boundaries", '<span data-type="mark">甲<span data-type="strong sup">乙</span>丙</span>');
    preview.bus.emit("switch-protyle", { protyle: preview.protyle });
  });
  const settled = () => page.waitForFunction(() => {
    const plugin = window.annotationPreview.plugin;
    return plugin.rootId === "inline-formatting-doc" && !plugin.loading && !plugin.patching && !plugin.replacing && !plugin.queued.length &&
      plugin.index?.annotations.length === 4 && document.querySelector(".sya-document__count")?.textContent === "4";
  });
  await settled();
  assert.deepEqual(await page.locator(".sya-card__sample").allTextContents(), ["前文关键词后文", "甲", "乙", "丙"]);
  const sample = page.locator(".sya-card__sample").first();
  assert.deepEqual(await sample.locator("span").evaluateAll(nodes => nodes.map(node => [node.textContent, getComputedStyle(node).verticalAlign])),
    [["前文", "baseline"], ["关键", "super"], ["词", "sub"], ["后文", "baseline"]]);
  await page.locator(".sya-search__input").fill("前文关键词后文");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 1 && !document.querySelector('.sya-tree[aria-busy="true"]'));
  await page.locator(".sya-card").click();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "前文关键词后文");
  await page.locator(".sya-search__input").fill("");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 4);
  // This goes through the real Worker query path.
  const queryScript = async field => page.evaluate(async field => {
    const plugin = window.annotationPreview.plugin;
    return (await plugin.actions.queryAnnotations({ rootId: plugin.rootId, version: 1, environment: {}, query: {
      search: "", quick: "all", rule: { kind: "condition", field, value: "yes", exclude: false },
    } })).keys;
  }, field);
  assert.equal((await queryScript("sup")).length, 2);
  assert.equal((await queryScript("sub")).length, 1);
  const semantics = () => page.evaluate(() => {
    const block = document.querySelector('[data-node-id="mixed"]');
    return [...block.querySelectorAll('[data-href], [data-type~="block-ref"]')].map(node => ({
      text: node.textContent, href: node.getAttribute("data-href"), title: node.getAttribute("data-title"),
      id: node.getAttribute("data-id"), subtype: node.getAttribute("data-subtype"), memo: node.getAttribute("data-inline-memo-content"),
    }));
  });
  const originalSemantics = await semantics();
  for (const mode of ["preserve", "replace"]) {
    const before = await page.evaluate(() => window.annotationPreview.transactions);
    await page.evaluate(async mode => {
      const plugin = window.annotationPreview.plugin;
      await plugin.actions.replaceAnnotation(plugin.index.annotations.find(a => a.blockId === "mixed"), "blue", mode);
    }, mode);
    await settled();
    assert.equal(await page.evaluate(() => window.annotationPreview.transactions), before + 1);
    assert.deepEqual(await semantics(), originalSemantics);
    const scriptTypes = await page.locator('[data-node-id="mixed"] [data-type~="sup"], [data-node-id="mixed"] [data-type~="sub"]').allTextContents();
    assert.deepEqual(scriptTypes, mode === "preserve" ? ["关键", "词"] : []);
    assert.equal(await page.locator(".sya-card__sample").first().textContent(), "前文关键词后文");
    await page.evaluate(() => window.annotationPreview.undo()); await settled();
    await page.waitForFunction(() => window.annotationPreview.plugin.index.annotations[0].runs?.length === 4);
    await page.evaluate(() => window.annotationPreview.redo()); await settled();
    await page.waitForFunction(mode => !!window.annotationPreview.plugin.index.annotations[0].runs === (mode === "preserve"), mode);
  }
  assert.deepEqual(errors, []);
  console.log("Inline formatting browser passed: merged cards with precise scripts, full-text search/navigation, Worker filters, link/reference/memo semantics, both replacement modes and undo/redo.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
