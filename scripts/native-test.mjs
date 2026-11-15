import { selectStyle } from "./style-picker-test-helpers.mjs";
import { chromium } from "playwright";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

// Only the separately launched acceptance kernel, never the user's main workspace.
const base = "http://127.0.0.1:6917";
const workspace = path.resolve("artifacts/acceptance-0.2.0/workspace");
const api = async (route, body = {}) => {
  const response = await fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(result.code, 0, `${route}: ${result.msg}`);
  return result.data;
};
assert.ok(
  (await readFile(path.join(workspace, "conf/conf.json"), "utf8")).includes(
    '"system"',
  ),
);
const activeWorkspaces = (await api("/api/system/getWorkspaces")).filter(item => !item.closed);
assert.equal(activeWorkspaces.length, 1, "Acceptance kernel must have exactly one active workspace");
assert.equal(path.resolve(activeWorkspaces[0].path), workspace, "Refusing to modify a kernel serving another workspace");
await mkdir(path.join(workspace, "data/plugins/sy-annotation"), {
  recursive: true,
});
await cp("dist", path.join(workspace, "data/plugins/sy-annotation"), {
  recursive: true,
});
await api("/api/setting/setBazaar", { trust: true });
await api("/api/petal/setPetalEnabled", {
  packageName: "sy-annotation",
  enabled: true,
});
let notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(
  (item) => item.name === "Annotation v0.2 QA",
);
if (!notebook) {
  await api("/api/notebook/createNotebook", { name: "Annotation v0.2 QA" });
  notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find(
    (item) => item.name === "Annotation v0.2 QA",
  );
}
const notebookId = notebook.notebook?.id ?? notebook.id;
const doc = await api("/api/filetree/createDocWithMd", {
  notebook: notebookId,
  path: `/v02-native-qa-${Date.now()}`,
  markdown:
    "# 验收标题\n\n第一段原生组合样式测试文字。\n\n第二段用于跨块标注测试。",
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
      console.log("native console:", message.text());
    }
  });
  await page.goto(`${base}/?id=${doc}`);
  try {
    await page.waitForFunction(
      () =>
        !!window.siyuan?.ws?.app?.plugins?.find(
          (plugin) => plugin.name === "sy-annotation",
        ),
      { timeout: 30000 },
    );
  } catch (error) {
    await page.screenshot({ path: "test-results/native-error.png" });
    console.log(
      await page.evaluate(() => ({
        text: document.body.innerText.slice(0, 3500),
        hasSiyuan: !!window.siyuan,
        keys: window.siyuan ? Object.keys(window.siyuan) : [],
        plugins: window.siyuan?.ws?.app?.plugins?.map((plugin) => plugin.name),
      })),
      errors,
    );
    throw error;
  }
  await page.waitForFunction(
    (doc) =>
      window.siyuan.ws.app.plugins.find(
        (plugin) => plugin.name === "sy-annotation",
      )?.rootId === doc,
    doc,
  );
  const dockType = await page.evaluate(
    () =>
      Object.keys(
        window.siyuan.ws.app.plugins.find(
          (plugin) => plugin.name === "sy-annotation",
        ).docks,
      )[0],
  );
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dockType}"]`).click();
  await page.locator(".sya-panel").waitFor();
  assert.equal(await page.locator('.sya-panel .sya-manage-tools use[href="#iconSettings"]').count(), 1);
  assert.equal(await page.locator('.sya-panel [aria-label="刷新标注"] use[href="#iconRefresh"]').count(), 1);
  await page.waitForFunction(
    () =>
      document.querySelector(".sya-document__count")?.textContent === "0" &&
      !document.querySelector('.sya-tree[aria-busy="true"]'),
  );
  let fullReads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/block/getBlockDOM") &&
      request.postDataJSON()?.id === doc
    )
      fullReads++;
  });
  await selectStyle(page, ".sya-panel .sya-palette", "wave");
  await page.locator('.sya-panel .sya-continuous').click();
  await page.evaluate(() => {
    const plugin = window.siyuan.ws.app.plugins.find(
      (plugin) => plugin.name === "sy-annotation",
    );
    const editable = plugin.active.wysiwyg.element.querySelector(
      '[data-type="NodeParagraph"] [contenteditable="true"]',
    );
    editable.focus();
    const text = editable.firstChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 10);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    editable.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, bubbles: true }),
    );
  });
  await page.waitForFunction(
    () => document.querySelector(".sya-document__count")?.textContent === "1",
  );
  await page.waitForFunction(() => [...document.querySelectorAll(".sya-card__sample")].some(node => getComputedStyle(node).textDecorationStyle === "wavy"));
  await page.evaluate(() =>
    window.siyuan.ws.app.plugins
      .find((plugin) => plugin.name === "sy-annotation")
      .active.getInstance()
      .flushPendingTransactions(),
  );
  const marked = await api("/api/block/getBlockDOM", { id: doc });
  assert.match(marked.dom, /text-decoration-style: wavy/);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => document.querySelector(".sya-document__count")?.textContent === "0",
  );
  await page.evaluate(() =>
    window.siyuan.ws.app.plugins
      .find((plugin) => plugin.name === "sy-annotation")
      .active.getInstance()
      .flushPendingTransactions(),
  );
  assert.doesNotMatch(
    (await api("/api/block/getBlockDOM", { id: doc })).dom,
    /wavy/,
  );
  await page.keyboard.press("Control+y");
  await page.waitForFunction(
    () => document.querySelector(".sya-document__count")?.textContent === "1",
  );
  assert.equal(
    fullReads,
    0,
    "native edits/undo/redo must use incremental indexing",
  );
  await page.keyboard.press("Escape");
  await page.locator(".sya-panel .sya-palette summary").click();
  await page.locator(".sya-panel .sya-manage-tools").click();
  await page.getByRole("button", { name: "新建工具", exact: true }).click();
  await page.locator('[data-field="label"]').fill("原生组合验收");
  await page.locator('[data-mark="strong"]').check();
  await selectStyle(page, '[data-color-property="background-color"]', "native:backgroundColor:4");
  await page
    .locator('[data-field="text-decoration-style"]')
    .selectOption("wavy");
  await page.locator(".sya-save-tool").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".sya-manager__error")
      ?.textContent.includes("已保存"),
  );
  await page.getByRole("button", { name: "关闭工具设置", exact: true }).click();
  const customId = await page.evaluate(
    () =>
      window.siyuan.ws.app.plugins
        .find((plugin) => plugin.name === "sy-annotation")
        .config.tools.find((tool) => tool.label === "原生组合验收").id,
  );
  await selectStyle(page, ".sya-panel .sya-palette", customId);
  await page.locator('.sya-panel .sya-continuous').click();
  await page.evaluate(() => {
    const plugin = window.siyuan.ws.app.plugins.find(
      (plugin) => plugin.name === "sy-annotation",
    );
    const editable = plugin.active.wysiwyg.element.querySelectorAll(
      '[data-type="NodeParagraph"] [contenteditable="true"]',
    );
    editable[0].focus();
    const range = document.createRange();
    range.setStart(editable[0], 0);
    range.setEnd(editable[1].firstChild, 5);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    editable[1].dispatchEvent(
      new PointerEvent("pointerup", { button: 0, bubbles: true }),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.protyle-wysiwyg [data-type~="strong"]')
        .length >= 2,
  );
  await page.evaluate(() =>
    window.siyuan.ws.app.plugins
      .find((plugin) => plugin.name === "sy-annotation")
      .active.getInstance()
      .flushPendingTransactions(),
  );
  const combined = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.match(combined, /background-color/);
  assert.match(combined, /strong/);
  assert.match(combined, /wavy/);
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.protyle-wysiwyg [data-type~="strong"]')
        .length === 0,
  );
  await page.evaluate(() =>
    window.siyuan.ws.app.plugins
      .find((plugin) => plugin.name === "sy-annotation")
      .active.getInstance()
      .flushPendingTransactions(),
  );
  const undone = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.doesNotMatch(undone, /strong/);
  assert.match(undone, /wavy/);
  await page.keyboard.press("Control+y");
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.protyle-wysiwyg [data-type~="strong"]')
        .length >= 2,
  );
  await page.evaluate(() =>
    window.siyuan.ws.app.plugins
      .find((plugin) => plugin.name === "sy-annotation")
      .active.getInstance()
      .flushPendingTransactions(),
  );
  assert.equal(fullReads, 0);
  await page.screenshot({ path: "test-results/native-initial.png" });
  await page.reload();
  await page.waitForFunction(
    (doc) =>
      window.siyuan?.ws?.app?.plugins?.find(
        (plugin) => plugin.name === "sy-annotation",
      )?.rootId === doc,
    doc,
  );
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dockType}"]`).click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".sya-document__count")?.textContent) > 0 &&
      !document.querySelector('.sya-tree[aria-busy="true"]'),
  );
  assert.ok(
    (await page.locator('.protyle-wysiwyg [data-type~="strong"]').count()) >= 2,
  );
  assert.ok(
    (await api("/api/block/getBlockDOM", { id: doc })).dom.includes("wavy"),
  );
  const info = await page.evaluate(() => {
    const plugin = window.siyuan.ws.app.plugins.find(
      (plugin) => plugin.name === "sy-annotation",
    );
    return {
      pluginLoaded: !!plugin,
      active: plugin.active?.block,
      rootId: plugin.rootId,
      panelCount: document.querySelectorAll(".sya-panel").length,
      text: document.body.innerText.slice(0, 2500),
    };
  });
  console.log(JSON.stringify({ doc, notebookId, ...info }, null, 2));
  await writeFile(
    "test-results/native-bootstrap.json",
    JSON.stringify({ doc, notebookId, ...info, errors }, null, 2),
  );
  assert.deepEqual(
    errors.filter((error) => error.includes("sy-annotation")),
    [],
  );
  console.log(
    "Native SiYuan 3.8.10 passed: wave persistence, one-step cross-block combination undo/redo, incremental broadcasts, restart persistence.",
  );
} finally {
  await browser.close();
}
