# 标注大纲 / Annotation Outline 0.4.1

## 中文

- 选中正文中样式一致的文字，点击「组合工具」区的「＋」，即可新建组合样式，保留原生颜色引用、浅深配色及文字效果。
- 移除「继承思源最近使用的样式」选项；无有效选区、无样式或混合样式时提示重新选择。新建样式不会改写正文。
- 组合工具改为紧凑的样式预览方格，隐藏名称文字，悬停可查看名称；加号和设置齿轮直接放在同一分组中。
- 压缩侧栏工具栏，样式选择、标注和连续标注保持同一行，侧栏与浮动工具栏使用一致的组合工具入口。
- 修复组合样式保存时下划线与删除线同时存在的效果保留，更新中英文介绍与使用图。

## English

- Select uniformly styled document text and click the plus in Combination tools to create a combination, preserving native color references, light/dark colors and text effects.
- Removed copying from SiYuan’s most recently used style. Missing, unstyled or mixed selections show a helpful message. Creating a tool leaves the document unchanged.
- Made combinations compact preview swatches with names available on hover. The plus and settings gear sit directly in the same group.
- Kept style selection, Annotate and Continuous annotation on one sidebar row, with matching combination-tool entry points in both toolbars.
- Preserved simultaneous underline and strike-through effects when saving combinations, and refreshed the Chinese and English illustrated guides.

---

# 标注大纲 / Annotation Outline 0.4.0

## 中文

- 统一接入思源原生样式库，同步自定义样式、顺序、隐藏状态和浅深配色；插件独立记住当前标注样式。
- 新增原生「默认样式、默认文字颜色、默认背景颜色」，并可从分组末尾的齿轮直接打开思源颜色管理；返回时保留筛选与批量修改草稿。
- 压缩侧栏顶部，统一工具栏、筛选和批量面板；样式选择浮层自动避开窗口边缘，批量修改提供清晰的源样式、目标样式与前后预览。
- 新增按原生样式引用查找，区分外观相同的不同样式；支持全文、筛选范围及未加载标注的批量替换。
- 保留旧固定色与浅深色表达式，提供可预览、可备份的旧颜色迁移入口。
- 优化当前位置卡片提示与筛选同步，保留原生事务、一次撤销和过期预览保护。

## English

- Unified the native SiYuan style library, including custom styles, ordering, visibility and light/dark colors. The plugin remembers its annotation style independently.
- Added native defaults for styles, text colors and backgrounds, with direct access to SiYuan’s color manager. Filter and batch drafts survive the round trip.
- Made the sidebar more compact and aligned toolbars, filters and batch dialogs. Style popups stay within the window; batch changes clearly show the source, target and before/after preview.
- Added native-style reference matching to distinguish identical-looking styles, including batch changes across the document, filtered results and unloaded annotations.
- Preserved existing fixed and dual-theme colors, with previewed migration and tool backups.
- Improved current-position feedback and filter synchronization while retaining native transactions, one-step undo and stale-preview protection.

---

# 标注大纲 / Annotation Outline 0.3.9

## 中文

- 中英文介绍图与使用图改为固定版本的 GitHub 链接，需要联网加载。
- 安装包移除介绍图片，仅保留集市图标和封面，减少下载与同步体积。
- 打包使用安装文件清单，避免旧构建目录中的图片重新混入安装包。

## English

- Documentation screenshots now load from GitHub URLs pinned to an existing release. An internet connection is required to view them.
- Removed documentation images from the installation archive while retaining the marketplace icon and cover.
- Added an explicit package file list to exclude stale build assets.

---

# 标注大纲 / Annotation Outline 0.3.8

## 中文

首次公开发布：在思源文档中连续划选标注，并按标题层级回顾高亮、文字颜色和划线，支持搜索、组合筛选、原文跳转与批量改样式。

- 新增完整英文界面，跟随思源语言设置；默认工具名称随语言显示，自定义工具名称与笔记内容保留原样。
- 新增透明圆角图标、中英文集市介绍、封面、功能总览和四张使用步骤图。
- 补充深浅色界面展示；介绍图片随安装包分发。
- 调整筛选条件列宽，使英文匹配条件清晰可读。

支持桌面端、桌面浏览器与桌面独立窗口。移动端、PDF 画布标注和全工作空间汇总不在本版本范围。

## English

First public release: annotate passages in SiYuan and review highlights, text colors and underlines by heading. Includes search, combined filters, source navigation and previewed batch style changes.

- Added a complete English interface following SiYuan's language setting. Built-in tool labels are localized; custom names and document content remain unchanged.
- Added a transparent rounded-corner icon, Chinese and English marketplace descriptions, covers, overview artwork and four illustrated usage guides.
- Included light/dark examples and bundled all documentation images for local loading.
- Widened filter columns for readable English matching controls.

Supports desktop, desktop browser and desktop windows. Mobile, PDF-canvas annotations and workspace-wide indexing are outside this version's scope.
