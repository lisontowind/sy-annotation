import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
const base = "http://127.0.0.1:6917";
const api = async (route, body = {}) => {
  const r = await (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  assert.equal(r.code, 0, r.msg); return r.data;
};
const workspaces = (await api("/api/system/getWorkspaces")).filter((w) => !w.closed);
assert.equal(workspaces.length, 1); assert.equal(path.resolve(workspaces[0].path), path.resolve("artifacts/acceptance-0.2.0/workspace"));
const notebook = (await api("/api/notebook/lsNotebooks")).notebooks.find((n) => n.name === "Annotation v0.2 QA");
const doc = await api("/api/filetree/createDocWithMd", { notebook: notebook.id, path: `/v03-semantics-${Date.now()}`, markdown: "# 引用目标\n\n==[链接原文](https://example.com)==\n\n引用占位" });
const dom = (await api("/api/block/getBlockDOM", { id: doc })).dom;
const blocks = [...dom.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
await api("/api/block/updateBlock", { id: blocks[2], dataType: "dom", data: `<div data-node-id="${blocks[2]}" data-type="NodeParagraph"><div contenteditable="true"><span data-type="block-ref mark" data-id="${blocks[0]}" data-subtype="s">引用原文</span></div></div>` });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?id=${doc}`);
  await page.waitForFunction((id) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === id, doc);
  const dockType = await page.evaluate(() => Object.keys(window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation").docks)[0]);
  if (!await page.locator(".sya-panel").isVisible()) await page.locator(`.dock__item[data-type="${dockType}"]`).click();
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "2" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  for (const text of ["链接原文", "引用原文"]) {
    await page.evaluate(async (text) => {
      const plugin = window.siyuan.ws.app.plugins.find((p) => p.name === "sy-annotation");
      const annotation = plugin.index.annotations.find((a) => a.text === text);
      if (!annotation) throw new Error("Missing annotation " + text);
      await plugin.actions.replaceAnnotation(annotation, "blue", "replace");
    }, text);
    await page.waitForFunction(() => !document.querySelector('.sya-tree[aria-busy="true"]'));
  }
  const after = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.match(after, /data-href="https:\/\/example.com"/);
  assert.match(after, /data-type="[^"]*block-ref/);
  assert.ok(after.includes(`data-id="${blocks[0]}"`));
  assert.equal((after.match(/background-color/g) || []).length, 2);
  assert.doesNotMatch(after, /data-type="[^"]*mark/);
  await page.reload();
  await page.waitForFunction((id) => window.siyuan?.ws?.app?.plugins?.find((p) => p.name === "sy-annotation")?.rootId === id, doc);
  const reopened = (await api("/api/block/getBlockDOM", { id: doc })).dom;
  assert.match(reopened, /data-href="https:\/\/example.com"/); assert.ok(reopened.includes(`data-id="${blocks[0]}"`));
  console.log("Native semantics passed: full replacement preserves link destinations and block-reference IDs after save/reopen.");
} finally { await browser.close(); }
