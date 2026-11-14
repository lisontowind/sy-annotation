# 图标制作记录

使用内置 image_gen 工具生成；未使用 CLI 或额外 API 密钥。最终介绍图与使用图由 scripts/marketplace-native.mjs 在真实思源 3.8.10 独立测试工作空间截图，再由 scripts/marketplace-assets.mjs 排版。截图采用思源桌面浏览器界面，通知在截图前通过自己的关闭按钮收起。

## 初次生成提示词

```text
Use case: logo-brand
Asset type: square app icon for a SiYuan Note desktop plugin named Annotation Outline (标注大纲), to be reduced to 160x160.
Primary request: design a refined, memorable icon expressing highlighted text organized as a heading outline. One softly rounded square tile in deep ink teal. Inside, a warm ivory paper/document with a few dark teal horizontal text strokes, three small branching outline dots along the left, and one confident golden-yellow translucent marker stroke across the middle text. A small elegant highlighter nib integrated at the lower right of the page, tilted diagonally.
Style: polished editorial productivity app icon, crisp flat shapes with very subtle soft dimensional lighting, restrained and friendly, not cartoonish.
Composition: one centered standalone icon, square image, tile fills the canvas edge to edge with modest rounded corners; generous breathing room for the paper silhouette; strong readable silhouette at 32px.
Palette: deep teal #164D4A, warm ivory #FFFDF5, golden yellow #F4CC54, muted sage accents.
Text: no letters, no words, no numbers.
Constraints: original brand mark; no SiYuan logo; no other logos; no tiny details; no watermark; no mockup device; no outer shadow outside tile. Opaque background.
```

## 透明圆角修改提示词

```text
Use case: background-extraction
Asset type: final transparent PNG app icon.
Edit target: the supplied Annotation Outline app icon.
Change ONLY the four outer black corners outside the deep teal rounded-square tile to genuine alpha transparency. Preserve the exact teal rounded-square tile silhouette, paper, branching outline, text strokes, yellow highlight, highlighter pen, colors and proportions. The inside of the teal tile and all illustrated objects remain opaque. Clean anti-aliased outer rounded corners. No opaque white or black backdrop, no checkerboard painted into the pixels, no added padding, no added shadow. Output genuine transparent PNG.
```

最终原图：icon-transparent-master.png；集市交付图：../../icon.png。原图 RGBA，四个外角 alpha 为 0。160 × 160 图标由原图等比缩小，保留透明通道。
