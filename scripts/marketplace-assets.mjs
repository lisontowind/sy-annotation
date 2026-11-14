// Reproducible marketplace artwork, using the real plugin in its local demo host.
// No publishing, external services, or changes to the user's SiYuan workspace.
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { startPreview } from "./preview.mjs";
import { captureDemo } from "./marketplace-demo.mjs";
import { captureNative, prepareNativeDocuments, restoreNativeSettings } from "./marketplace-native.mjs";

const assets = "docs/assets";
const { version } = JSON.parse(await readFile("plugin.json", "utf8"));
const review = `artifacts/marketplace-review-${version}`;
await mkdir(assets, { recursive: true });
await mkdir(`${assets}/en`, { recursive: true });
await mkdir(review, { recursive: true });
const native = process.argv.includes("--native");
const { server, url } = native ? { server: null, url: "http://127.0.0.1:6917" } : await startPreview(0);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const errors = [];
const englishScreenshots = new Map();
const png = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
const icon = png(await readFile("icon.png"));
const font = '"Microsoft YaHei", "Segoe UI", sans-serif';

const englishCopy = new Map([
  ["思源笔记 · 桌面端插件", "SiYuan Note · Desktop plugin"],
  ["思源笔记插件 / 功能总览", "SiYuan plugin / Overview"],
  ["让标注，<br>成为有结构的回顾。", "Turn highlights<br>into a structured review."],
  ["按章节汇总 · 连续划选 · 筛选与改样式", "Review by heading · Annotate · Filter & restyle"],
  ["读过的重点，按章节重新看见。", "Rediscover highlights, chapter by chapter."],
  ["原文中的高亮与划线，汇成可以搜索、筛选、点击跳转的标注大纲。", "Your highlights and underlines, organized into a searchable outline with links to the source."],
  ["选一个样式，把重点留在原文里。", "Choose a style. Mark what matters."],
  ["单次标注与连续标注分开控制，按自己的阅读节奏使用。", "Apply a style once, or keep selecting passages in continuous mode."],
  ["选择样式本身不会改写选区。", "Choosing a style does not alter the selection."],
  ["在侧栏选择高亮、下划线或波浪线。选择样式本身不会改写选区。", "Choose a highlight, underline or wavy line. Selecting a style alone does not change the text."],
  ["标注一次，或连续划选", "Once, or continuously"],
  ["点击「标注」处理一处；点击「连续标注」后，每次划选都会应用当前样式。", "Click Annotate for one passage, or Continuous to apply the style to each new selection."],
  ['按 <span class="key">Esc</span> 退出。也可以在连续标注中切换样式。', 'Press <span class="key">Esc</span> to exit. You can switch styles while annotating continuously.'],
  ["沿着标题层级，回到当时的思考。", "Revisit your thinking, in context."],
  ["搜索标注或标题，保留章节上下文；点击卡片即可跳回原文。", "Search passages or headings. Click a card to return to its source."],
  ["H1–H6 自动组织标注；折叠标题，专注当前章节。", "Annotations follow H1–H6 headings. Collapse sections to focus your review."],
  ["输入关键词，再结合样式筛选，缩小回顾范围。卡片保留原文样式。", "Combine keywords with style filters. Cards retain the original colors and line effects."],
  ["单击准星定位当前位置；双击锁定自动跟随，再次双击解除。", "Click the crosshair to locate your position. Double-click to lock or unlock automatic following."],
  ["先筛出目标，再统一改样式。", "Find the right passages. Restyle together."],
  ["把颜色、划线、章节组合成条件；批量操作前先看命中数量和前后效果。", "Combine style and section rules. Review match counts and before/after examples before applying."],
  ["「并且 / 或者」、匹配 / 排除与嵌套分组，<br>可与关键词和快捷样式筛选共同生效。", "AND / OR, matching, exclusions and nested groups.<br>Combine with keyword search and quick style filters."],
  ["选择源样式、目标工具、替换模式与范围。<br>确认后整批作为一次思源原生撤销操作。", "Choose source, target, replacement mode and scope.<br>The whole batch is one native SiYuan undo operation."],
  ["预览后批量修改", "Preview, then apply"],
  ["为自己的阅读，留一套标注语言。", "Build your own annotation language."],
  ["调整颜色与组合效果，实时预览；工具也可以继承思源当前选中的一个样式。", "Preview colors and combined effects, or copy the single style most recently selected in SiYuan."],
  ["侧栏「＋」新建，齿轮打开设置；右键样式也可编辑或删除。", "Use + to create a tool, or the gear to manage tools. Right-click a style to edit or delete it."],
  ["前景色、背景色、高亮、划线、加粗等效果可组合，边改边看预览。", "Combine text color, background, highlights, lines and bold, with a live preview."],
  ["修改或删除工具，只影响后续操作。已保存的原文格式在卸载后仍然保留。", "Editing tools affects future actions. Saved document formatting remains after uninstalling."],
  ["新建与管理工具", "Create and manage tools"],
  ["组合自己的样式", "Combine your effects"],
  ["历史标注继续保留", "Keep existing highlights"],
  ["搜索与样式筛选", "Search and filter"],
  ["定位与自动跟随", "Locate and follow"],
  ["按章节回顾", "Review by heading"],
  ["选择样式", "Choose a style"],
  ["随时结束", "Stop at any time"],
  ["组合筛选", "Combined filters"],
  ["真实插件界面 · 演示宿主与示例文档", "Real plugin UI · demo host · English interface"],
  ["标注大纲", "Annotation Outline"],
]);
function translateArtwork(body) {
  for (const [zh, en] of [...englishCopy].sort((a,b) => b[0].length - a[0].length)) body = body.replaceAll(zh, en);
  body = body.replaceAll("思源真实界面 · 独立测试空间 · 示例文档", "Real SiYuan UI · isolated test workspace · English");
  for (const [zh, en] of englishScreenshots) body = body.replaceAll(zh, en);
  assert.ok(!/[\u4e00-\u9fff]/.test(body), "Artwork contains untranslated Chinese copy");
  return body;
}

async function render(filename, width, height, body, extra = "", english = false) {
  if (native) body = body.replaceAll("真实插件界面 · 演示宿主与示例文档", "思源真实界面 · 独立测试空间 · 示例文档");
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#f7f6ef;color:#183d3b;font-family:${font};-webkit-font-smoothing:antialiased}
  .canvas{position:relative;width:${width}px;height:${height}px;overflow:hidden;padding:56px 60px}
  .eyebrow{font:600 14px/1.5 "Segoe UI",sans-serif;letter-spacing:3px;color:#53736c}
  .header{display:flex;justify-content:space-between;align-items:center}.brand{display:flex;align-items:center;gap:12px;font-size:19px;font-weight:700;letter-spacing:.5px}.brand img{width:40px;height:40px}.pill{border:1px solid #cdd9cf;border-radius:30px;padding:8px 16px;font-size:13px;color:#53736c}
  h1{font-size:48px;line-height:1.35;letter-spacing:-1px;margin:16px 0 12px;font-weight:700}p{font-size:21px;color:#627670;line-height:1.8;margin:0}
  .frame{overflow:hidden;border-radius:16px;border:1px solid #d9e0d7;background:white;box-shadow:0 20px 55px #254e3d14}.frame img{display:block;width:100%}
  .foot{position:absolute;bottom:26px;left:60px;right:60px;display:flex;justify-content:space-between;font-size:12px;color:#71827c}
  .note{padding:23px 0;border-bottom:1px solid #dae2d8}.note:last-child{border:0}.num{display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:50%;background:#e1eadc;color:#28564d;font-size:14px;font-weight:700;margin-bottom:12px}
  .note h3{font-size:23px;margin:0 0 9px}.note p{font-size:17px;line-height:1.85}.key{background:#fff;border:1px solid #d7dfd4;border-bottom:3px solid #d7dfd4;padding:1px 8px;border-radius:5px;font:16px "Segoe UI",sans-serif}.highlight{background:#f6df8b;padding:0 4px;border-radius:3px}
  ${extra}</style><div class="canvas">${body}</div></html>`);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
  const overflow = await page.evaluate(() => [...document.querySelectorAll(".note,.foot,h1,p")].filter(el => el.getBoundingClientRect().bottom > innerHeight).map(el => el.textContent));
  assert.deepEqual(overflow, [], `${filename}: text exceeds canvas`);
  const frameOverflow = await page.evaluate(() => [...document.querySelectorAll(".frame")].filter(el => el.getBoundingClientRect().bottom > innerHeight - 60).length);
  assert.equal(frameOverflow, 0, `${filename}: artwork overlaps footer or exceeds canvas`);
  await page.screenshot({ path: filename });
  await page.close();
  if (!english && !filename.includes("icon-transparency")) {
    const englishPath = filename === "preview.png" ? `${assets}/en/preview.png` : filename.replace(`${assets}/`, `${assets}/en/`);
    await render(englishPath, width, height, translateArtwork(body), extra + ".note p{font-size:16px;line-height:1.7}.note h3{font-size:21px}h1{font-size:44px}.pill{font-size:12px}", true);
  }
}

const foot = (right = `ANNOTATION OUTLINE · ${version}`) => `<div class="foot"><span>真实插件界面 · 演示宿主与示例文档</span><span>${right}</span></div>`;
const title = (n, heading, sub) => `<div class="eyebrow">ANNOTATION OUTLINE / ${n}</div><h1>${heading}</h1><p>${sub}</p>`;
const note = (n, heading, sub) => `<div class="note"><span class="num">${n}</span><h3>${heading}</h3><p>${sub}</p></div>`;

try {
  if (native) await prepareNativeDocuments();
  const capture = native ? captureNative : captureDemo;
  const zh = await capture(browser, url, review + (native ? "/native-zh" : ""), "zh-CN");
  const en = await capture(browser, url, review + (native ? "/native-en" : "/en"), "en-US");
  for (const key of Object.keys(zh)) englishScreenshots.set(png(zh[key]), png(en[key]));
  await writeFile(assets + "/interface-dark.png", zh.dark);
  await writeFile(assets + "/en/interface-dark.png", en.dark);
  const { overview, annotate, search, filter, batch, tools } = zh;

  await render("preview.png", 1024, 768, `
    <div class="header"><div class="brand"><img src="${icon}">标注大纲</div><span class="pill">思源笔记 · 桌面端插件</span></div>
    <div style="position:absolute;left:52px;top:120px"><div class="eyebrow">HIGHLIGHT. CONNECT. REVISIT.</div><h1 style="font-size:49px;margin-top:14px">让标注，<br>成为有结构的回顾。</h1><p style="font-size:18px;margin-top:15px">按章节汇总 · 连续划选 · 筛选与改样式</p></div>
    <img src="${icon}" style="position:absolute;right:69px;top:132px;width:142px;height:142px">
    <div class="frame" style="position:absolute;left:52px;top:363px;width:920px;height:337px"><img src="${png(overview)}" style="margin-top:-38px"></div>
    <div class="foot" style="left:52px;right:52px;bottom:25px"><span>真实插件界面 · 演示宿主与示例文档</span><span>ANNOTATION OUTLINE</span></div>
  `, ".canvas{padding:42px 52px}.brand{font-size:21px}.brand img{width:44px;height:44px}");

  await render(`${assets}/overview.png`, 1600, 1260, `
    <div class="header"><div class="brand"><img src="${icon}">标注大纲</div><span class="pill">思源笔记插件 / 功能总览</span></div>
    <h1>读过的重点，按章节重新看见。</h1><p>原文中的高亮与划线，汇成可以搜索、筛选、点击跳转的标注大纲。</p>
    <div class="frame" style="position:absolute;left:60px;right:60px;top:250px"><img src="${png(overview)}"></div>${foot()}
  `);

  await render(`${assets}/usage-01-annotate.png`, 1600, 1000, `
    ${title("01 / ANNOTATE", "选一个样式，把重点留在原文里。", "单次标注与连续标注分开控制，按自己的阅读节奏使用。")}
    <div class="frame" style="position:absolute;left:60px;top:235px;width:1070px"><img src="${png(annotate)}"></div>
    <div style="position:absolute;left:1170px;right:60px;top:215px">
    ${note("1", "选择样式", "在侧栏选择高亮、下划线或波浪线。选择样式本身不会改写选区。")}
    ${note("2", "标注一次，或连续划选", "点击「标注」处理一处；点击「连续标注」后，每次划选都会应用当前样式。")}
    ${note("3", "随时结束", '按 <span class="key">Esc</span> 退出。也可以在连续标注中切换样式。')}
    </div>${foot()}
  `);
  await render(`${assets}/usage-02-outline.png`, 1600, 1000, `
    ${title("02 / REVISIT", "沿着标题层级，回到当时的思考。", "搜索标注或标题，保留章节上下文；点击卡片即可跳回原文。")}
    <div class="frame" style="position:absolute;left:60px;top:235px;width:1070px"><img src="${png(search)}"></div>
    <div style="position:absolute;left:1170px;right:60px;top:215px">
    ${note("1", "按章节回顾", "H1–H6 自动组织标注；折叠标题，专注当前章节。")}
    ${note("2", "搜索与样式筛选", "输入关键词，再结合样式筛选，缩小回顾范围。卡片保留原文样式。")}
    ${note("3", "定位与自动跟随", "单击准星定位当前位置；双击锁定自动跟随，再次双击解除。")}
    </div>${foot()}
  `);
  await render(`${assets}/usage-03-filter-batch.png`, 1600, 1140, `
    ${title("03 / REFINE", "先筛出目标，再统一改样式。", "把颜色、划线、章节组合成条件；批量操作前先看命中数量和前后效果。")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:44px;margin-top:28px">
    <div><h3 style="font-size:22px;margin:0 0 15px"><span class="num" style="margin:0 10px 0 0">1</span>组合筛选</h3><div class="frame"><img src="${png(filter)}"></div><p style="font-size:17px;margin-top:20px">「并且 / 或者」、匹配 / 排除与嵌套分组，<br>可与关键词和快捷样式筛选共同生效。</p></div>
    <div><h3 style="font-size:22px;margin:0 0 15px"><span class="num" style="margin:0 10px 0 0">2</span>预览后批量修改</h3><div class="frame"><img src="${png(batch)}"></div><p style="font-size:17px;margin-top:20px">选择源样式、目标工具、替换模式与范围。<br>确认后整批作为一次思源原生撤销操作。</p></div>
    </div>${foot()}
  `);
  await render(`${assets}/usage-04-tools.png`, 1600, 1200, `
    ${title("04 / PERSONALIZE", "为自己的阅读，留一套标注语言。", "调整颜色与组合效果，实时预览；工具也可以继承思源当前选中的一个样式。")}
    <div class="frame" style="position:absolute;left:60px;top:250px;width:880px"><img src="${png(tools)}"></div>
    <div style="position:absolute;left:1010px;right:60px;top:232px">
    ${note("1", "新建与管理工具", "侧栏「＋」新建，齿轮打开设置；右键样式也可编辑或删除。")}
    ${note("2", "组合自己的样式", "前景色、背景色、高亮、划线、加粗等效果可组合，边改边看预览。")}
    ${note("3", "历史标注继续保留", "修改或删除工具，只影响后续操作。已保存的原文格式在卸载后仍然保留。")}
    </div>${foot()}
  `);
  await render(`${review}/icon-transparency.png`, 1200, 520, `
    <div class="eyebrow">ICON / ALPHA CHECK</div><h1 style="font-size:30px">圆角外侧透明，适配深浅背景。</h1>
    <div style="display:flex;gap:25px;margin-top:25px">
    ${["#ffffff", "#202328", "repeating-conic-gradient(#e0e4e1 0% 25%,white 0% 50%) 50% / 20px 20px"].map((bg,i)=>`<div style="width:340px;height:260px;border:1px solid #d3dbd3;border-radius:16px;background:${bg};display:flex;align-items:center;justify-content:center;gap:30px"><img src="${icon}" width="160" height="160"><img src="${icon}" width="32" height="32"></div>`).join("")}</div>
  `, ".canvas{padding:35px 50px}");
  assert.deepEqual(errors, [], "Demo must have no uncaught runtime errors");
  const names = ["overview.png", "usage-01-annotate.png", "usage-02-outline.png", "usage-03-filter-batch.png", "usage-04-tools.png"];
  const files = ["icon.png", "preview.png", `${assets}/interface-dark.png`, `${assets}/en/preview.png`, `${assets}/en/interface-dark.png`, ...names.flatMap(f => [`${assets}/${f}`, `${assets}/en/${f}`])];
  const sizes = await Promise.all(files.map(async file => ({ file, bytes: (await stat(file)).size })));
  assert.ok(sizes[0].bytes <= 64 * 1024, "Icon must be <=64KiB");
  assert.ok(sizes[1].bytes <= 512 * 1024, "Preview must be <=512KiB");
  await writeFile(`${review}/assets.json`, JSON.stringify({ source: native ? "Real SiYuan 3.8.10 browser-desktop in isolated test workspace; sample documents" : "Real plugin UI in local mock SiYuan host; sample content", files: sizes, runtimeErrors: errors }, null, 2));
  console.log(JSON.stringify(sizes, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (native) {
    await restoreNativeSettings();
  }
}
