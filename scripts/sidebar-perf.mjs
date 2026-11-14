import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { startPreview } from "./preview.mjs";
import assert from "node:assert/strict";
const { server, url } = await startPreview(0);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "6" && !document.querySelector('.sya-tree[aria-busy="true"]'));
  await page.evaluate(() => {
    const source = [];
    for (let i = 0; i < 20000; i++) {
      if (i % 100 === 0) source.push(`<div data-node-id="h${i}" data-type="NodeHeading" data-subtype="h1"><div contenteditable="true">章节 ${i / 100}</div></div>`);
      source.push(`<div data-node-id="p${i}" data-type="NodeParagraph"><div contenteditable="true">${i < 10000 ? `<span data-type="mark">标注 ${i} ${"长卡片文本 ".repeat(i % 7)}</span>` : `正文 ${i}`}</div></div>`);
    }
    window.annotationPreview.setVirtualDocument(source.join(""));
  });
  await page.waitForFunction(() => document.querySelector(".sya-document__count")?.textContent === "10000" && !document.querySelector('.sya-tree[aria-busy="true"]'), null, { timeout: 30000 });
  const result = await page.evaluate(async () => {
    const plugin = window.annotationPreview.plugin;
    const panel = [...plugin.panels][0]; const virtual = panel.virtual;
    const tree = document.querySelector(".sya-tree");
    const metrics = { plainMs: [], markedMs: [], setRows: 0, fullSnapshots: 0, deltaMessages: 0, replacedRows: 0, draws: [], followMs: [], followRenders: 0, maxMounted: 0 };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const idle = async () => { for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 5)); if (!plugin.patching && !plugin.queued.length && !tree.hasAttribute("aria-busy")) return; } throw new Error("index did not settle"); };
    const originalSet = virtual.setRows.bind(virtual); virtual.setRows = (...args) => { metrics.setRows++; return originalSet(...args); };
    const originalDraw = virtual.draw.bind(virtual); virtual.draw = (...args) => { const start = performance.now(); const value = originalDraw(...args); metrics.draws.push(performance.now() - start); metrics.maxMounted = Math.max(metrics.maxMounted, tree.querySelectorAll(".sya-virtual-row").length); return value; };
    const originalRender = panel.renderTree.bind(panel); panel.renderTree = (...args) => { metrics.followRenders++; return originalRender(...args); };
    plugin.indexer.worker.addEventListener("message", (event) => { if (event.data.index) metrics.fullSnapshots++; if (event.data.delta) metrics.deltaMessages++; });
    const observer = new MutationObserver((records) => { for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && node.classList.contains("sya-virtual-row")) metrics.replacedRows++; });
    observer.observe(tree, { childList: true, subtree: true });
    const edit = async (id, marked, round) => {
      const html = `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${marked ? `<span data-type="mark">正在输入 ${round}</span>` : `普通输入 ${round}`}</div></div>`;
      const start = performance.now();
      window.annotationPreview.bus.emit("ws-main", { cmd: "transactions", data: [{ doOperations: [{ action: "update", id, data: html }] }] });
      await idle(); (marked ? metrics.markedMs : metrics.plainMs).push(performance.now() - start);
    };
    for (let i = 0; i < 15; i++) await edit("p15000", false, i);
    const plain = { setRows: metrics.setRows, snapshots: metrics.fullSnapshots, replaced: metrics.replacedRows };
    for (let i = 0; i < 15; i++) await edit("p0", true, i);
    const afterEdits = { setRows: metrics.setRows, replaced: metrics.replacedRows };
    const beforeFollow = metrics.followRenders;
    plugin.caretBlockId = "p0"; plugin.caretOffset = 0;
    for (let i = 0; i < 20; i++) { const start = performance.now(); plugin.locate(true, false); metrics.followMs.push(performance.now() - start); }
    plugin.caretOffset = 100000;
    for (let i = 0; i < 20; i++) { const start = performance.now(); plugin.locate(true, false); metrics.followMs.push(performance.now() - start); }
    if (tree.querySelector('.sya-card.is-current, .sya-card[aria-current="location"]')) throw new Error("Unmarked positions must not select a nearby card");
    metrics.followRenders -= beforeFollow;
    for (let i = 0; i < 50; i++) { tree.scrollTop += 650; await frame(); }
    await idle(); observer.disconnect();
    const distribution = (values) => ({ median: values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)], p95: values.slice().sort((a, b) => a - b)[Math.floor(values.length * .95)], max: Math.max(...values) });
    return { plain: { ...plain, ...distribution(metrics.plainMs) }, marked: { ...afterEdits, ...distribution(metrics.markedMs) }, fullSnapshots: metrics.fullSnapshots, deltaMessages: metrics.deltaMessages, follow: { renders: metrics.followRenders, ...distribution(metrics.followMs) }, draw: distribution(metrics.draws), maxMounted: metrics.maxMounted, annotations: panel.annotations.length };
  });
  assert.deepEqual(errors, []); assert.equal(result.annotations, 10000); assert.ok(result.maxMounted < 80);
  if (process.argv.includes("--verify")) {
    assert.equal(result.plain.setRows, 0, "plain typing must not redraw the sidebar");
    assert.equal(result.fullSnapshots, 0, "leaf edits must not transfer the complete document index");
    assert.ok(result.deltaMessages > 0); assert.ok(result.follow.renders <= 1, "repeated follow in the same section must not rebuild rows");
  }
  await mkdir("test-results", { recursive: true });
  const label = process.argv.find((arg) => arg.startsWith("--label="))?.slice(8) || "latest";
  await writeFile(`test-results/sidebar-perf-${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
