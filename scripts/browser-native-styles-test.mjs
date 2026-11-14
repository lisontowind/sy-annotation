import { chromium } from "playwright";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";
import { selectStyle } from "./style-picker-test-helpers.mjs";

const { server, url } = await startPreview(0);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const first = "20261115100000-sourcea", second = "20261115100001-sourceb";
const firstId = `native:custom:${first}`, secondId = `native:custom:${second}`;
const data = { version: 2, styles: [
  { id: first, name: "论据", light: { color: "#112233" }, dark: { color: "#ddeeff" } },
  { id: second, name: "同色的另一类", light: { color: "#112233" }, dark: { color: "#ddeeff" } },
], builtin: { colors: [], styles: [{ id: "error", light: { color: "#334455", backgroundColor: "#f1e2d3" }, dark: { color: "#ccbbaa", backgroundColor: "#443322" } }], hidden: { color: [2], backgroundColor: [], style1: [] } },
order: { color: [first, "3", "1"], backgroundColor: [], style1: [] } };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url); await page.waitForSelector(".sya-card");
  await page.evaluate(({ data, first, second }) => {
    const preview = window.annotationPreview;
    preview.setNativeStyles(data, false); // The originating window gets only a native stylesheet update.
    preview.protyle.block.rootID = "native-style-search";
    const p = (id, style, text, mark = "") => `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true"><span data-type="text ${mark}" style="${style}">${text}</span></div></div>`;
    preview.protyle.wysiwyg.element.innerHTML = p("first", `color:var(--b3-inline-style-${first}-color,#123456)`, "第一条论据") +
      p("next", `color:var(--b3-inline-style-${first}-color,#654321)`, "第二条论据", "u") +
      p("other", `color:var(--b3-inline-style-${second}-color,#112233)`, "同色的其他样式") +
      p("fixed", "color:#112233", "旧固定颜色") +
      p("builtin", "color:var(--b3-card-error-color);background-color:var(--b3-card-error-background)", "原生组合配色");
    preview.bus.emit("switch-protyle", { protyle: preview.protyle });
  }, { data, first, second });
  await page.waitForFunction(id => window.annotationPreview.plugin.availableTools.some(tool => tool.id === id), firstId);
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "5" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  const transactions = () => page.evaluate(() => window.annotationPreview.transactions);
  const initialTransactions = await transactions();
  const cardColor = text => page.locator(".sya-card").filter({ hasText: text }).locator(".sya-card__sample").evaluate(node => getComputedStyle(node).color);
  assert.equal(await cardColor("第一条论据"), "rgb(17, 34, 51)");
  assert.equal(await cardColor("原生组合配色"), "rgb(51, 68, 85)", "editor-scoped built-in overrides also reach plugin cards");
  await selectStyle(page, ".sya-panel .sya-palette", firstId);
  await page.locator(".sya-panel .sya-palette summary").click();
  assert.equal(await page.locator('.sya-panel .sya-palette [data-style-group="color"] [data-tool-id]').first().getAttribute("data-tool-id"), "native:color:default");
  assert.equal(await page.locator('.sya-panel .sya-palette [data-style-group="color"] [data-tool-id]').nth(1).getAttribute("data-tool-id"), firstId);
  assert.equal(await page.locator('.sya-panel .sya-palette [data-style-group="color"] [data-tool-id="native:color:2"]').count(), 0);
  await page.screenshot({ path: "test-results/native-style-panel.png" });
  await page.locator(".sya-panel .sya-palette summary").click();
  await page.evaluate(secondId => {
    window.siyuan.storage["local-fontstyles"] = [`color\u200bvar(--b3-inline-style-${secondId}-color, #112233)`];
    window.annotationPreview.bus.emit("ws-main", { cmd: "setLocalStorageVal", data: { key: "local-fontstyles", val: window.siyuan.storage["local-fontstyles"] } });
  }, second);
  assert.equal(await page.evaluate(() => window.annotationPreview.plugin.config.selectedId), firstId, "native selection does not change plugin selection");
  await page.locator("#theme-toggle").click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-node-id="first"] span')).color === "rgb(221, 238, 255)");
  assert.equal(await cardColor("第一条论据"), "rgb(221, 238, 255)");
  await page.locator("#theme-toggle").click(); assert.equal(await transactions(), initialTransactions);
  await selectStyle(page, ".sya-style-filter", firstId);
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 2 && !document.querySelector('.sya-tree[aria-busy="true"]'));
  await page.locator(".sya-search__input").fill("第二条");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 1);
  await page.locator(".sya-search__input").fill(""); await selectStyle(page, ".sya-style-filter", "all");
  await page.locator(".sya-more-filters").click(); await page.locator(".sya-add-condition").click();
  assert.equal(await page.locator(".sya-rule-field").inputValue(), "nativeStyle");
  await selectStyle(page, ".sya-rule-value", firstId);
  await page.waitForFunction(() => document.querySelector(".sya-filter-dialog .sya-dialog-status")?.textContent === "命中 2 处标注");
  await page.locator(".sya-filter-apply").click();
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 2);
  await page.locator(".sya-open-bulk").click();
  await selectStyle(page, ".sya-batch-source", firstId); await selectStyle(page, ".sya-batch-target", secondId);
  await page.locator(".sya-batch-scope").selectOption("filtered");
  await page.waitForFunction(() => !document.querySelector(".sya-batch-execute").disabled && document.querySelector(".sya-batch-execute").textContent === "修改 2 处");
  await page.locator(".sya-batch-execute").click(); await page.locator(".sya-replacement-dialog").waitFor({ state: "detached" });
  assert.equal(await transactions(), initialTransactions + 1, "same-looking references change in one transaction");
  assert.match(await page.locator('[data-node-id="first"]').innerHTML(), new RegExp(second));
  await page.evaluate(() => window.annotationPreview.undo());
  await page.waitForFunction(first => document.querySelectorAll(".sya-card").length === 2 &&
    !document.querySelector('.sya-tree[aria-busy="true"]') &&
    window.annotationPreview.plugin.index?.annotations.find(annotation => annotation.blockId === "first")?.signature.includes(first), first);
  await page.evaluate(async secondId => {
    const plugin = window.annotationPreview.plugin;
    window.staleNativePlan = await plugin.prepareReplacement(plugin.index.annotations.slice(0, 1), secondId, "replace", new AbortController().signal, () => {});
  }, secondId);
  data.styles[0].name = "已改名的论据";
  await page.evaluate(data => window.annotationPreview.setNativeStyles(data, false), data);
  await page.waitForFunction(() => window.annotationPreview.plugin.availableTools.some(tool => tool.label === "已改名的论据"));
  const stale = await page.evaluate(async () => { try { await window.annotationPreview.plugin.commitReplacement(window.staleNativePlan, new AbortController().signal, () => {}); return "committed"; } catch (error) { return error.message; } });
  assert.match(stale, /重新预览/); assert.equal(await transactions(), initialTransactions + 1);
  data.styles[0].hidden = true;
  await page.evaluate(data => window.annotationPreview.setNativeStyles(data), data);
  await page.waitForFunction(id => window.annotationPreview.plugin.availableTools.find(tool => tool.id === id)?.hidden, firstId);
  assert.equal(await page.evaluate(() => window.annotationPreview.plugin.config.selectedId), firstId);
  assert.equal(await page.locator(".sya-panel .sya-apply").isDisabled(), false, "hiding only affects the library choices");
  await page.locator(".sya-panel .sya-continuous").click();
  data.styles = data.styles.filter(style => style.id !== first);
  await page.evaluate(data => window.annotationPreview.setNativeStyles(data), data);
  await page.waitForFunction(() => document.querySelector(".sya-panel .sya-apply").disabled);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  assert.equal(await page.evaluate(() => window.annotationPreview.plugin.config.selectedId), firstId);
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 2, null, { timeout: 20000 });
  assert.equal(await transactions(), initialTransactions + 1, "sync and deletion never write document content");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tools.json")).tools.some(tool => tool.id.startsWith("native:"))), false);
  await page.reload(); await page.waitForSelector(".sya-card");
  assert.equal(await page.evaluate(() => window.annotationPreview.plugin.config.selectedId), firstId, "independent native selection survives restart even if its source is gone");
  assert.equal(await page.locator(".sya-panel .sya-apply").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("Native style browser passed: source-window and broadcast sync, native grouping/order/hiding, scoped colors, identity search, independent selection, same-color batch/undo, revision guards, deletion and restart.");
} catch (error) { await browser.contexts()[0]?.pages()[0]?.screenshot({ path: "test-results/native-styles-error.png" }); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
