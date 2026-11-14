import { chromium } from "playwright";
import { cp } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { selectStyle } from "./style-picker-test-helpers.mjs";

const base = "http://127.0.0.1:6917", workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
async function api(route, body = {}) {
  const result = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(result.code, 0, `${route}: ${result.msg}`); return result.data;
}
const active = (await api("/api/system/getWorkspaces")).filter(item => !item.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace, "Only the isolated acceptance workspace may be modified");
const originalStyles = await api("/api/storage/getInlineStyles");
const originalAppearance = (await api("/api/system/getConf")).conf.appearance;
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
await api("/api/setting/setAppearance", { ...originalAppearance, lang: "zh-CN", modeOS: false, mode: 0 });
const first = "20261115120000-nativea", second = "20261115120001-nativeb", firstId = `native:custom:${first}`, secondId = `native:custom:${second}`;
const palette = { ...structuredClone(originalStyles), styles: [...originalStyles.styles.filter(style => ![first, second].includes(style.id)),
  { id: first, name: "原生证据", light: { color: "#112233" }, dark: { color: "#ddeeff" } },
  { id: second, name: "同色的另一类", light: { color: "#112233" }, dark: { color: "#ddeeff" } },
] };
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page, originalConfig;
try {
  await api("/api/storage/setInlineStyles", palette);
  const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(item => item.name === "Annotation v0.2 QA"); assert.ok(notebook);
  const span = (id, text) => `<span data-type="text" style="color:var(--b3-inline-style-${id}-color, #112233)">${text}</span>`;
  const markdown = [...Array.from({ length: 240 }, (_, i) => span(first, `原生证据 ${i}`)), span(second, "其他原生样式"), '<span data-type="text" style="color:#112233">旧固定色</span>'].join("\n\n");
  const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/native-styles-${Date.now()}`, markdown });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", error => { if (error.stack?.includes("sy-annotation")) errors.push(error.message); });
  let transactions = 0;
  page.on("request", request => { if (request.url().endsWith("/api/transactions")) transactions++; });
  const ready = async () => {
    await page.waitForFunction(doc => window.siyuan?.ws?.app?.plugins?.find(plugin => plugin.name === "sy-annotation")?.rootId === doc, doc);
    const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").docks)[0]);
    if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
    await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "242" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  };
  await page.goto(`${base}/?id=${doc}`); await ready();
  originalConfig = await page.evaluate(() => structuredClone(window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").config));
  assert.ok(await page.locator(".protyle-wysiwyg [data-node-id]").count() < 240, "most source blocks remain unloaded");
  await page.waitForFunction(firstId => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").availableTools.some(tool => tool.id === firstId), firstId);
  await selectStyle(page, ".sya-panel .sya-palette", firstId);
  const original = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  palette.styles.find(style => style.id === first).name = "原生证据已改名";
  palette.styles.find(style => style.id === first).light.color = "#223344";
  palette.styles.find(style => style.id === second).light.color = "#223344";
  await api("/api/storage/setInlineStyles", palette);
  await page.waitForFunction(() => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").availableTools.some(tool => tool.label === "原生证据已改名"));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sya-card__sample")).color === "rgb(34, 51, 68)");
  assert.equal((await api("/api/block/getBlockDOM", { id: doc })).dom, original, "changing native definitions does not rewrite annotations");
  assert.equal(await page.evaluate(() => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").config.selectedId), firstId);
  await selectStyle(page, ".sya-style-filter", firstId);
  await page.waitForFunction(() => document.querySelector(".sya-tree-label")?.textContent.includes("找到 240 处"));
  await page.locator(".sya-search__input").fill("原生证据 239");
  await page.waitForFunction(() => document.querySelectorAll(".sya-card").length === 1 && document.querySelector(".sya-card__sample")?.textContent === "原生证据 239");
  await page.locator(".sya-card").click();
  await page.waitForFunction(() => getSelection()?.toString() === "原生证据 239");
  await page.locator(".sya-search__input").fill("");
  await page.waitForFunction(() => document.querySelector(".sya-tree-label")?.textContent.includes("找到 240 处"));
  assert.equal(transactions, 0, "native sync, searching and navigation create no body transactions");
  await page.locator(".sya-open-bulk").click();
  await selectStyle(page, ".sya-batch-source", firstId); await selectStyle(page, ".sya-batch-target", secondId);
  await page.locator(".sya-batch-scope").selectOption("filtered");
  await page.waitForFunction(() => !document.querySelector(".sya-batch-execute").disabled && document.querySelector(".sya-batch-execute").textContent === "修改 240 处");
  await page.locator(".sya-batch-execute").click(); await page.locator(".sya-replacement-dialog").waitFor({ state: "detached" });
  assert.equal(transactions, 1, "one native transaction includes unloaded annotations");
  const changed = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((changed.match(new RegExp(`--b3-inline-style-${second}-color`, "g")) || []).length, 241);
  const history = async redo => page.evaluate(async redo => {
    const protyle = window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").active;
    await protyle.undo[redo ? "redo" : "undo"](protyle); await protyle.getInstance().flushPendingTransactions();
  }, redo);
  await history(false);
  assert.equal(((await api("/api/block/getBlockDOM", { id: doc })).dom.match(new RegExp(`--b3-inline-style-${first}-color`, "g")) || []).length, 240);
  await history(true);
  assert.equal(((await api("/api/block/getBlockDOM", { id: doc })).dom.match(new RegExp(`--b3-inline-style-${second}-color`, "g")) || []).length, 241);
  await page.reload(); await ready();
  assert.equal(((await api("/api/block/getBlockDOM", { id: doc })).dom.match(new RegExp(`--b3-inline-style-${second}-color`, "g")) || []).length, 241);
  await page.locator(".sya-panel .sya-continuous").click();
  palette.styles = palette.styles.filter(style => style.id !== first);
  await api("/api/storage/setInlineStyles", palette);
  await page.waitForFunction(() => document.querySelector(".sya-panel .sya-apply").disabled);
  assert.equal(await page.locator(".sya-editor-indicator").count(), 0);
  assert.equal(await page.evaluate(() => window.siyuan.ws.app.plugins.find(plugin => plugin.name === "sy-annotation").config.selectedId), firstId);
  await page.locator(".sya-panel .sya-palette summary").click();
  await page.screenshot({ path: "test-results/native-native-style-panel.png" });
  assert.deepEqual(errors, []);
  console.log("Native style integration passed: real palette broadcasts, live colors without body writes, independent selection, identity search through unloaded blocks, 240 replacements in one undo/redo, reload and deletion.");
} catch (error) {
  if (page) {
    await page.screenshot({ path: "test-results/native-styles-error.png" });
    console.log(await page.evaluate(() => ({
      selection: getSelection()?.toString(),
      activeRoot: window.siyuan?.ws?.app?.plugins?.find(plugin => plugin.name === "sy-annotation")?.rootId,
      status: document.querySelector(".sya-document__count")?.textContent,
      cards: [...document.querySelectorAll(".sya-card__sample")].map(node => node.textContent).slice(0, 3),
    })));
  }
  throw error;
} finally {
  if (page && originalConfig) await page.evaluate(async config => {
    const plugin = window.siyuan?.ws?.app?.plugins?.find(plugin => plugin.name === "sy-annotation");
    if (plugin) await plugin.saveData("tools.json", config);
  }, originalConfig).catch(() => {});
  await browser.close();
  await api("/api/storage/setInlineStyles", originalStyles); await api("/api/setting/setAppearance", originalAppearance);
}
