import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const directory = `artifacts/marketplace-review-${manifest.version}`;
await mkdir(directory, { recursive: true });
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const dataImage = async file => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
async function markdown(file) {
  const source = await readFile(file, "utf8");
  const images = new Map();
  for (const [,path] of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) images.set(path, await dataImage(path));
  const inline = text => escape(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_,alt,path) => `<figure><img class="zoom" src="${images.get(path)}" alt="${alt}" loading="lazy"><figcaption>${alt}</figcaption></figure>`)
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_,label,url) => url === "README.md" || url === "README.en.md" ? `<button class="textlink" onclick="choose('${url === "README.md" ? "zh" : "en"}')">${label}</button>` : /^https?:/.test(url) ? `<a href="${url}">${label}</a>` : `<span title="${url}">${label}</span>`)
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
  let result = "", list = "", table = false;
  for (const line of source.split(/\r?\n/)) {
    const type = /^- /.test(line) ? "ul" : /^\d+\. /.test(line) ? "ol" : "";
    if (list && list !== type) { result += `</${list}>`; list = ""; }
    if (line.startsWith("|")) {
      if (/^\|[\s|:-]+\|$/.test(line)) continue;
      if (!table) { result += "<div class='tablewrap'><table>"; table = true; }
      result += `<tr>${line.split("|").slice(1,-1).map(cell => `<td>${inline(cell.trim())}</td>`).join("")}</tr>`; continue;
    }
    if (table) { result += "</table></div>"; table = false; }
    if (!line.trim()) continue;
    if (type) { if (!list) { list = type; result += `<${type}>`; } result += `<li>${inline(line.replace(/^(?:- |\d+\. )/, ""))}</li>`; continue; }
    const heading = /^(#{1,3}) (.*)/.exec(line);
    if (heading) { result += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`; continue; }
    if (line.startsWith("> ")) { result += `<blockquote>${inline(line.slice(2))}</blockquote>`; continue; }
    result += line.startsWith("![") ? inline(line) : `<p>${inline(line)}</p>`;
  }
  if (list) result += `</${list}>`; if (table) result += "</table></div>";
  return result;
}
const icon = await dataImage("icon.png");
const cover = await dataImage("preview.png");
const coverEn = await dataImage("docs/assets/en/preview.png");
const alpha = await dataImage(`${directory}/icon-transparency.png`);
const zh = await markdown("README.md"), en = await markdown("README.en.md");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>标注大纲 ${manifest.version} · 发布前预览</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.9 "Microsoft YaHei","Segoe UI",sans-serif;background:#f5f5ee;color:#213e3a}header{border-bottom:1px solid #dfe4d9;background:#fffefa}nav{max-width:1200px;margin:auto;padding:20px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.brand{display:flex;gap:12px;align-items:center;font-weight:700}.brand img{width:36px;height:36px}.status{margin-left:auto;background:#f9ecc5;color:#735a23;padding:4px 13px;border-radius:20px;font-size:13px}main{max-width:1200px;margin:auto;padding:38px 24px 80px}.topline{font-size:12px;letter-spacing:3px;color:#698278}h1{font-size:38px;line-height:1.4;margin:12px 0 18px}h2{font-size:26px;margin:48px 0 18px}h3{font-size:20px}.lead{color:#647a71;max-width:900px}.tabs{display:flex;gap:8px;margin:28px 0 22px;position:sticky;top:0;background:#f5f5eeed;padding:12px 0;z-index:2}.tab{padding:10px 25px;border:1px solid #d5dfd3;background:white;border-radius:9px;font:inherit;cursor:pointer}.tab.active{background:#194d47;color:white;border-color:#194d47}.hero{display:grid;grid-template-columns:270px 1fr;gap:24px;align-items:start}.card{background:#fffefa;border:1px solid #dce2d6;border-radius:18px;overflow:hidden}.iconstage{height:240px;background:repeating-conic-gradient(#e6e9e4 0% 25%,#fff 0% 50%) 50%/24px 24px;display:grid;place-items:center}.iconstage img{width:160px;height:160px}.cardtext{padding:20px 22px}.cardtext p{font-size:14px;color:#6b7e72;margin:5px 0}.cover{width:100%;display:block}.locale{display:none}.locale.active{display:block}.alpha{width:100%;margin-top:22px;border:1px solid #dce2d6;border-radius:14px}.review-note{margin:26px 0;padding:16px 20px;border-left:4px solid #d3b85b;background:#fff8e4;font-size:14px;color:#766748}article{max-width:1024px;margin:55px auto 0;padding:38px 48px;background:white;border:1px solid #dce2d6;border-radius:18px}article h1{font-size:30px}article h2{font-size:23px}article p,article li{font-size:15px;color:#405c53}article li{margin:9px 0}article figure{margin:28px -16px}article img{display:block;width:100%;border-radius:8px}figcaption{color:#819082;font-size:12px;text-align:center;margin-top:9px}blockquote{border-left:3px solid #b7cdb7;padding:10px 18px;margin:20px 0;background:#f6f9f3;color:#6d7f72;font-size:13px}code{background:#f0f3ed;padding:2px 5px;border-radius:4px;font-size:13px;overflow-wrap:anywhere}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}td{border:1px solid #dce2d6;padding:9px 12px}tr:first-child{font-weight:700;background:#f3f6ee}a,.textlink{color:#2f7769}.textlink{background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:underline}.zoom{cursor:zoom-in}dialog{border:0;border-radius:12px;padding:10px;background:#f7f8f3;max-width:96vw;max-height:96vh}dialog::backdrop{background:#000b}dialog img{display:block;max-width:91vw;max-height:87vh;object-fit:contain}dialog button{display:block;margin-left:auto;border:0;background:none;padding:5px 12px;font:inherit;cursor:pointer}.fine{font-size:13px;color:#7b8a7e;margin-top:22px}@media(max-width:760px){.hero{grid-template-columns:1fr}.iconstage{height:210px}.status{margin-left:0}h1{font-size:29px}article{padding:20px}main{padding:24px 16px}.hero .card:first-child{display:grid;grid-template-columns:1fr 1fr}.iconstage img{width:140px;height:140px}article figure{margin:20px -8px}}
</style></head><body><header><nav><div class="brand"><img src="${icon}">标注大纲 · ${manifest.version}</div><span class="status">本地候选 · 待你检查 · 尚未发布</span></nav></header><main>
<div class="topline">MARKETPLACE / REVIEW</div><h1>图标、介绍与使用图，一起检查。</h1><p class="lead">已提供中文和英文界面，以及配套的两套介绍与图片。下方可切换语言，点击图片放大查看。</p>
<div class="tabs" role="tablist"><button class="tab active" data-locale="zh" role="tab" aria-selected="true" onclick="choose('zh')">简体中文</button><button class="tab" data-locale="en" role="tab" aria-selected="false" onclick="choose('en')">English</button></div>
${[["zh",cover,zh],["en",coverEn,en]].map(([locale,src,copy])=>`<section class="locale ${locale==='zh'?'active':''}" data-locale="${locale}" lang="${locale==='zh'?'zh-CN':'en-US'}"><div class="hero"><div class="card"><div class="iconstage"><img src="${icon}" alt="Transparent rounded icon"></div><div class="cardtext"><strong>${locale==='zh'?'集市图标':'Marketplace icon'}</strong><p>160 × 160 · PNG / RGBA</p><p>${locale==='zh'?'圆角外侧透明，四角 alpha = 0':'Transparent outer corners; alpha = 0'}</p></div></div><div class="card"><img class="cover zoom" src="${src}" alt="${locale==='zh'?'中文封面':'English cover'}"></div></div><article>${copy}</article></section>`).join("")}
<h2>透明边角检查</h2><img class="alpha zoom" src="${alpha}" alt="浅色、深色和透明棋盘格上的图标">
<div class="review-note">发布前仍需补齐作者署名与 GitHub 仓库地址。项目当前未绑定 Git 仓库，清单中的 author 保留原值，url 尚未填写。确认素材后再完成发布信息并提交集市。</div>
<p class="fine">图标使用内置 image_gen；展示图来自思源 3.8.10 独立测试空间的真实桌面浏览器界面。素材来源、提示词、验证范围与发布说明保存在 docs/marketplace/。</p>
</main><dialog id="lightbox"><button onclick="this.closest('dialog').close()">关闭 / Close ×</button><img alt="Full-size preview"></dialog><script>
function choose(locale){document.querySelectorAll('.locale').forEach(el=>el.classList.toggle('active',el.dataset.locale===locale));document.querySelectorAll('.tab').forEach(el=>{const active=el.dataset.locale===locale;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active))});document.documentElement.lang=locale==='en'?'en-US':'zh-CN'}
document.querySelectorAll('.zoom').forEach(img=>img.addEventListener('click',()=>{const dialog=document.querySelector('#lightbox');dialog.querySelector('img').src=img.src;dialog.showModal()}));
</script></body></html>`;
await writeFile(`${directory}/review.html`,html);
// Verify the actual review artifact in both language tabs and at a narrow viewport.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
  await page.setContent(html);
  const validate = async () => {
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.locale.active img')].map(i=>{i.loading="eager";return i.decode()}))});
    assert.ok(await page.locator(".locale.active").isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Review has horizontal overflow");
  };
  await validate(); await page.screenshot({path:`${directory}/review-zh.png`});
  await page.getByRole("tab",{name:"English",exact:true}).click(); await validate(); await page.screenshot({path:`${directory}/review-en.png`});
  await page.locator(".locale.active .cover").click(); assert.ok(await page.locator("dialog").isVisible()); await page.locator("dialog button").click();
  await page.setViewportSize({width:600,height:950}); await validate();
} finally { await browser.close(); }
console.log(`Review page: ${directory}/review.html`);
if (process.argv.includes("--serve")) {
  const server = createServer(async(req,res)=>{if(req.url!=="/"&&req.url!=="/review"){res.writeHead(404);res.end();return;}res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(await readFile(`${directory}/review.html`));});
  await new Promise(resolve=>server.listen(4174,"127.0.0.1",resolve));
  console.log("Review server: http://127.0.0.1:4174");
}
