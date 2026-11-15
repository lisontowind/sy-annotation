import { selectStyle } from "./style-picker-test-helpers.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import ts from "typescript";

const base = "http://127.0.0.1:6917";
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
const { version } = JSON.parse(await readFile("plugin.json", "utf8"));
const review = `artifacts/marketplace-review-${version}`;
export async function nativeApi(route, body = {}) {
  const r = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(r.code, 0, `${route}: ${r.msg}`); return r.data;
}
export async function verifyNativeWorkspace() {
  const active = (await nativeApi("/api/system/getWorkspaces")).filter(w => !w.closed);
  assert.equal(active.length, 1); assert.equal(path.resolve(active[0].path), workspace, "Refusing to use any other SiYuan workspace");
}
async function saveNativeTools(tools) {
  const form = new FormData(); form.set("path", "/data/storage/petal/sy-annotation/tools.json");
  form.set("file", new Blob([JSON.stringify(tools)], { type: "application/json" }), "tools.json");
  const saved = await (await fetch(base + "/api/file/putFile", { method: "POST", body: form })).json();
  assert.equal(saved.code, 0);
}
export async function restoreNativeSettings() {
  await verifyNativeWorkspace();
  const appearance = JSON.parse(await readFile(`${review}/native-backup/appearance.json`, "utf8"));
  await nativeApi("/api/setting/setAppearance", appearance);
  await saveNativeTools(JSON.parse(await readFile(`${review}/native-backup/tools-before.json`, "utf8")));
}
export async function prepareNativeDocuments() {
  await verifyNativeWorkspace();
  await mkdir(`${review}/native-backup`, { recursive: true });
  for (const [name, read] of [
    ["tools-before.json", () => readFile(path.join(workspace, "data/storage/petal/sy-annotation/tools.json"), "utf8")],
    ["appearance.json", async () => JSON.stringify((await nativeApi("/api/system/getConf")).conf.appearance)],
  ]) {
    try { await readFile(`${review}/native-backup/${name}`, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(`${review}/native-backup/${name}`, await read());
    }
  }
  await nativeApi("/api/petal/setPetalEnabled", { packageName: "sy-annotation", enabled: true });
  const original = JSON.parse(await readFile(`${review}/native-backup/tools-before.json`, "utf8"));
  const tools = { version: 1, tools: original.tools.filter(t => ["yellow", "green", "blue", "pink", "underline", "wave"].includes(t.id)), selectedId: "yellow" };
  assert.equal(tools.tools.length, 6, "The isolated artwork workspace must contain the six starter tools");
  await saveNativeTools(tools);
  let meta; try { meta = JSON.parse(await readFile(`${review}/native-documents.json`, "utf8")); } catch { meta = {}; }
  let notebook = (await nativeApi("/api/notebook/lsNotebooks")).notebooks.find(n => n.name === "标注大纲 · 展示示例");
  if (!notebook) {
    await nativeApi("/api/notebook/createNotebook", { name: "标注大纲 · 展示示例" });
    notebook = (await nativeApi("/api/notebook/lsNotebooks")).notebooks.find(n => n.name === "标注大纲 · 展示示例");
  }
  meta.notebook = notebook.id;
  const document = new JSDOM(await readFile("preview/index.html", "utf8")).window.document;
  const blocks = [...document.querySelectorAll("#wysiwyg > [data-node-id]")];
  const sf = ts.createSourceFile("app.ts", await readFile("preview/app.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let english; const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "text" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) english = node.initializer.elements.map(e => e.text); ts.forEachChild(node, visit); }; visit(sf);
  assert.equal(english.length, blocks.length);
  for (const locale of ["zh", "en"]) {
    const content = blocks.map((b,i) => locale === "en" ? english[i] : b.querySelector("[contenteditable]").innerHTML);
    const title = locale === "en" ? "Turn reading into your own knowledge" : "如何把阅读变成自己的知识";
    if (!meta[locale]) meta[locale] = await nativeApi("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/${title}`, markdown: blocks.map((b,i) => `${b.dataset.type === "NodeHeading" ? "#".repeat(Number(b.dataset.subtype.slice(1))) + " " : ""}${new JSDOM(content[i]).window.document.body.textContent}`).join("\n\n") });
    const dom = new JSDOM((await nativeApi("/api/block/getBlockDOM", { id: meta[locale] })).dom);
    const native = [...dom.window.document.querySelectorAll('[data-type="NodeParagraph"],[data-type="NodeHeading"]')];
    assert.equal(native.length, blocks.length);
    meta[`${locale}Blocks`] = native.map(n => n.dataset.nodeId);
    for (let i = 0; i < native.length; i++) {
      native[i].querySelector("[contenteditable=true]").innerHTML = content[i];
      await nativeApi("/api/block/updateBlock", { id: native[i].dataset.nodeId, dataType: "dom", data: native[i].outerHTML });
    }
  }
  meta.version = await nativeApi("/api/system/version");
  meta.workspace = workspace;
  await writeFile(`${review}/native-documents.json`, JSON.stringify(meta, null, 2));
  return meta;
}

export async function captureNative(browser, _url, directory, locale = "zh-CN") {
  await verifyNativeWorkspace(); await mkdir(directory, { recursive: true });
  const en = locale === "en-US";
  const meta = JSON.parse(await readFile(`${review}/native-documents.json`, "utf8"));
  const doc = en ? meta.en : meta.zh;
  const blockIds = meta[en ? "enBlocks" : "zhBlocks"];
  const config = (await nativeApi("/api/system/getConf")).conf;
  await nativeApi("/api/setting/setAppearance", { ...config.appearance, lang: en ? "en" : "zh-CN", modeOS: false, mode: 0 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(25000);
  const errors = []; page.on("pageerror", e => { if (e.message.includes("sy-annotation")) errors.push(e.message); });
  const plugin = "window.siyuan.ws.app.plugins.find(p=>p.name==='sy-annotation')";
  const ready = n => page.waitForFunction(n => document.querySelector(".sya-document__count")?.textContent === String(n) && !document.querySelector('.sya-tree[aria-busy="true"]'), n);
  const shot = async name => {
    const notifications = await page.locator('#message .b3-snackbar').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0).length);
    assert.equal(notifications,0,"Close visible notifications before capturing marketplace screenshots");
    return page.screenshot({ path: `${directory}/interface-${name}.png` });
  };
  try {
    await page.goto(base + "/?id=" + doc);
    await page.waitForFunction(id => window.siyuan?.ws?.app?.plugins?.find(p => p.name === "sy-annotation")?.rootId === id, doc);
    assert.equal(await page.evaluate(() => window.siyuan.config.lang), en ? "en" : "zh-CN");
    const oldTabs = await page.locator('.layout-tab-bar li[data-type="tab-header"]').evaluateAll((nodes,doc) => nodes.filter(n => !n.querySelector(`[data-document-title-id="${doc}"]`) && !n.dataset.initdata?.includes(doc)).map(n => n.dataset.id), doc);
    for (const id of oldTabs) {
      const close = page.locator(`.layout-tab-bar [data-id="${id}"] .item__close`);
      if (await close.count()) await close.first().evaluate(n => n.click());
    }
    const dock = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").docks)[0]);
    if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dock}"]`).click();
    await ready(6);
    // Close the file tree using its own dock control; retain the native editor and toolbar.
    if (await page.locator('.dock__item[data-type="file"].dock__item--active').count()) await page.locator('.dock__item[data-type="file"]').click();
    const notice = page.locator('#message .b3-snackbar__close');
    await notice.first().waitFor({ state:"visible", timeout:2500 }).catch(()=>{});
    for (const message of await notice.all()) { if (await message.isVisible()) await message.click(); }
    await page.locator('#message .b3-snackbar').waitFor({state:"hidden",timeout:5000}).catch(()=>{});
    await page.mouse.move(60, 790);
    await page.locator(".sya-card").first().waitFor();
    const overview = await shot("light");
    const sidebar = await page.locator(".sya-panel").screenshot({ path: `${directory}/sidebar.png` });
    await nativeApi("/api/system/setAppearanceMode", { mode: 1 });
    await page.waitForFunction(() => { const color=getComputedStyle(document.querySelector('.protyle')).backgroundColor; return document.documentElement.dataset.themeMode === "dark" && Number(color.match(/\d+/)?.[0]) < 128; });
    const dark = await shot("dark");
    await nativeApi("/api/system/setAppearanceMode", { mode: 0 });
    await page.waitForFunction(() => { const color=getComputedStyle(document.querySelector('.protyle')).backgroundColor; return document.documentElement.dataset.themeMode === "light" && Number(color.match(/\d+/)?.[0]) > 128; });
    await selectStyle(page, ".sya-panel .sya-palette", "green");
    await page.locator(".sya-panel .sya-continuous").click();
    await page.evaluate(id => {
      const editable = document.querySelector(`[data-node-id="${id}"] [contenteditable=true]`);
      editable.focus(); const range = document.createRange(); range.setStart(editable.firstChild, 0); range.setEnd(editable.firstChild, 17);
      getSelection().removeAllRanges(); getSelection().addRange(range); editable.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
    }, blockIds[5]);
    await ready(7);
    await page.evaluate(async () => window.siyuan.ws.app.plugins.find(p => p.name === "sy-annotation").active.getInstance().flushPendingTransactions());
    const persisted = (await nativeApi("/api/block/getBlockDOM", { id: blockIds[5] })).dom;
    assert.match(persisted, /background-color/);
    await page.mouse.move(60,790); const annotate = await shot("annotate");
    await page.keyboard.press("Escape");
    await page.locator(".sya-search__input").fill(en ? "question" : "问题");
    await page.waitForFunction(() => !document.querySelector('.sya-tree[aria-busy="true"]') && document.querySelectorAll(".sya-card").length > 0 && document.querySelectorAll(".sya-card").length < 7);
    await page.mouse.move(60,790); const search = await shot("search");
    await page.locator(".sya-search__input").fill(""); await ready(7);
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
    await page.waitForFunction(text => document.querySelector(".sya-filter-dialog .sya-dialog-status")?.textContent === text, en ? "3 annotations matched" : "命中 3 处标注");
    const filter = await page.locator(".sya-filter-dialog").screenshot({ path: `${directory}/dialog-filter.png` });
    await page.getByRole("button", { name: en ? "Cancel filters" : "取消筛选", exact: true }).click();
    await page.locator(".sya-open-bulk").click(); await selectStyle(page, ".sya-batch-target", "blue");
    await page.waitForFunction(() => !document.querySelector(".sya-batch-execute").disabled);
    assert.equal(await page.locator(".sya-batch-execute").textContent(), en ? "Change 1" : "修改 1 处");
    const batch = await page.locator(".sya-replacement-dialog").screenshot({ path: `${directory}/dialog-batch.png` });
    await page.getByRole("button", { name: en ? "Cancel batch restyle" : "取消批量修改", exact: true }).click();
    await page.locator(".sya-panel .sya-palette summary").click();
    await page.locator(".sya-panel .sya-manage-tools").click();
    const tools = await page.locator(".sya-manager").screenshot({ path: `${directory}/dialog-tools.png` });
    assert.deepEqual(errors, []);
    await writeFile(`${directory}/provenance.json`, JSON.stringify({ host: "SiYuan native browser-desktop", version: meta.version, language: locale, documentId: doc, workspace, persistedAnnotation: true, mockHost: false }, null, 2));
    return { overview, sidebar, dark, annotate, search, filter, batch, tools };
  } catch (error) {
    await page.screenshot({ path: `${directory}/native-error.png` });
    console.log((await page.locator("body").innerText()).slice(-1300));
    console.log(await page.evaluate(() => ({ theme:document.documentElement.dataset,plugin:window.siyuan?.ws?.app?.plugins?.find(p=>p.name==='sy-annotation')?.rootId })));
    throw error;
  } finally { await context.close(); }
}
