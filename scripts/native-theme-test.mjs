import { chromium } from "playwright";
import { cp } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:6917", workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
async function api(route, body = {}) {
  const result = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(result.code, 0, `${route}: ${result.msg}`); return result.data;
}
const active = (await api("/api/system/getWorkspaces")).filter(item => !item.closed);
assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace, "Only the isolated acceptance workspace may be modified");
const originalAppearance = (await api("/api/system/getConf")).conf.appearance;
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), { recursive: true });
await api("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
await api("/api/setting/setAppearance", { ...originalAppearance, lang: "zh-CN", themeLight: "daylight", themeDark: "midnight", modeOS: false, mode: 0 });
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(item => item.name === "Annotation v0.2 QA"); assert.ok(notebook);
const markdown = ['<span data-type="text" style="color:light-dark(#112233, #ddeeff);background-color:var(--b3-font-background12)">双主题原文</span>',
  ...Array.from({ length: 240 }, (_, i) => `<span data-type="text" style="background-color:#fff88f">旧标注 ${i}</span>`)].join("\n\n");
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/theme-qa-${Date.now()}`, markdown });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", error => { if (error.message.includes("sy-annotation")) errors.push(error.message); });
  const ready = async () => {
    await page.waitForFunction(id => window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation")?.rootId === id, doc);
    const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").docks)[0]);
    if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
    await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "241" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  };
  await page.goto(`${base}/?id=${doc}`); await ready();
  const originalTools = await page.evaluate(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").config.tools);
  const loaded = await page.locator('.protyle-wysiwyg [data-node-id]').count(); assert.ok(loaded < 241, `source should be lazily loaded: ${loaded}`);
  const original = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.match(original, /light-dark\(#112233, #ddeeff\)/);
  assert.equal((original.match(/background-color:#fff88f/g) || []).length, 240);
  const pairColor = () => page.locator('.sya-card').filter({ hasText: "双主题原文" }).locator('.sya-card__sample').evaluate(node => getComputedStyle(node).color);
  assert.equal(await pairColor(), "rgb(17, 34, 51)");
  await api("/api/system/setAppearanceMode", { mode: 1 });
  await page.waitForFunction(() => document.documentElement.dataset.themeMode === "dark");
  assert.equal(await pairColor(), "rgb(221, 238, 255)");
  assert.equal((await api("/api/block/getBlockDOM", { id: doc })).dom, original, "theme switching must not rewrite the source");
  await api("/api/system/setAppearanceMode", { mode: 0 });
  await page.waitForFunction(() => document.documentElement.dataset.themeMode === "light" && getComputedStyle(document.documentElement).getPropertyValue('--b3-font-background12').trim() === '#fff88f');
  const writeDoc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/theme-write-qa-${Date.now()}`, markdown: "插件配色写入" });
  await page.goto(`${base}/?id=${writeDoc}`);
  await page.waitForFunction(id => window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation")?.rootId === id && document.querySelector('.sya-document__count')?.textContent === '0', writeDoc);
  const applied = await page.evaluate(async () => {
    const plugin = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation");
    await plugin.commitTools([...plugin.config.tools.filter(tool => tool.id !== "theme-pair"), { id: "theme-pair", label: "双配色写入验收", color: "#223344", marks: [], styles: { color: "light-dark(#223344, #ccddee)" } }]);
    plugin.chooseTool("theme-pair");
    const editable = [...plugin.active.wysiwyg.element.querySelectorAll('[contenteditable="true"]')].find(node => node.textContent.includes("插件配色写入"));
    if (!editable) throw new Error("The annotation paragraph must be loaded"); editable.focus();
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let text; while ((text = walker.nextNode()) && !text.textContent.includes("插件配色写入")) {}
    if (!text) throw new Error("The annotation text is missing");
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range); plugin.captureSelection();
    const captured = !!plugin.savedSelection;
    plugin.paint(false);
    await plugin.active.getInstance().flushPendingTransactions();
    return captured;
  });
  assert.ok(applied, "selection is valid in the native editor");
  await page.waitForFunction(async id => {
    const result = await (await fetch('/api/block/getBlockDOM', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })).json();
    return result.data.dom.replace(/\s/g, '').includes('light-dark(rgb(34,51,68),rgb(204,221,238))');
  }, writeDoc);
  await page.reload();
  await page.waitForFunction(id => window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation")?.rootId === id && document.querySelector('.sya-document__count')?.textContent === '1', writeDoc);
  assert.ok((await api("/api/block/getBlockDOM", { id: writeDoc })).dom.replace(/\s/g, '').includes('light-dark(rgb(34,51,68),rgb(204,221,238))'), "plugin-authored dual colors survive reload");
  await page.goto(`${base}/?id=${doc}`); await ready();
  await page.evaluate(async () => {
    const plugin = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation");
    await plugin.commitTools([...plugin.config.tools.filter(tool => tool.id !== "theme-legacy"), { id: "theme-legacy", label: "旧色验收", color: "#fff88f", marks: [], styles: { "background-color": "#fff88f" } }]);
    const plan = await plugin.prepareColorRepair("tools", [{ property: "background-color", from: "#fff88f", to: "var(--b3-font-background12)" }], new AbortController().signal);
    window.themeToolRepairPlan = plan;
    await plugin.openColorRepair();
  });
  const row = page.locator('.sya-repair-row').filter({ hasText: 'rgb(255,248,143)' });
  await row.locator('.sya-repair-enabled').check();
  await page.locator('.sya-repair-preview').click();
  await page.waitForFunction(() => !document.querySelector('.sya-repair-execute').disabled);
  await page.locator('.sya-repair-execute').click();
  await page.waitForFunction(() => document.querySelector('.sya-color-repair-dialog .sya-dialog-status')?.textContent === "颜色修复已完成");
  assert.equal(await page.evaluate(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").config.tools.find(tool => tool.id === "theme-legacy").styles['background-color']), "var(--b3-font-background12)");
  await page.reload(); await ready();
  await page.evaluate(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").openColorRepair());
  assert.equal(await page.locator('.sya-repair-restore').isEnabled(), true, "backup survives a frontend reload");
  await page.locator('.sya-repair-restore').click();
  await page.waitForFunction(() => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").config.tools.find(tool => tool.id === "theme-legacy").styles['background-color'] === "#fff88f");
  await page.getByRole("button", { name: "关闭颜色修复", exact: true }).click();
  let batches = 0;
  page.on("request", request => {
    if (request.url().endsWith("/api/transactions") && request.postDataJSON()?.transactions?.some(t => t.doOperations?.filter(o => o.action === "update").length === 240)) batches++;
  });
  const changed = await page.evaluate(async () => {
    const plugin = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation");
    const plan = await plugin.prepareColorRepair("document", [{ property: "background-color", from: "#fff88f", to: "var(--b3-font-background12)" }], new AbortController().signal);
    await plugin.commitReplacement(plan, new AbortController().signal, () => {}); return plan.changed;
  });
  assert.equal(changed, 240); assert.equal(batches, 1);
  const after = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((after.match(/var\(--b3-font-background12\)/g) || []).length, 241);
  assert.doesNotMatch(after, /background-color:#fff88f/);
  await page.evaluate(async () => {
    const protyle = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active;
    await protyle.undo.undo(protyle); await protyle.getInstance().flushPendingTransactions();
  });
  const undone = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((undone.match(/var\(--b3-font-background12\)/g) || []).length, 1, "one native undo restores every fixed color");
  await page.evaluate(async () => {
    const protyle = window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active;
    await protyle.undo.redo(protyle); await protyle.getInstance().flushPendingTransactions();
  });
  const redo = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((redo.match(/var\(--b3-font-background12\)/g) || []).length, 241, "one native redo restores every theme expression");
  await page.reload(); await ready();
  const reopened = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.equal((reopened.match(/var\(--b3-font-background12\)/g) || []).length, 241, "all theme expressions survive reload");
  assert.match(reopened, /light-dark\(#112233, #ddeeff\)/);
  await page.evaluate(async originalTools => { await window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").commitTools(originalTools); }, originalTools);
  await page.screenshot({ path: "test-results/native-theme-colors.png" }); assert.deepEqual(errors, []);
  console.log("Native theme passed: dual-color save/reload, theme changes without document writes, tool backup/restore, 240 repairs including unloaded blocks in one undo/redo transaction.");
} finally { await browser.close(); await api("/api/setting/setAppearance", originalAppearance); }
