# Annotation Outline · 标注大纲

**Turn highlights into a structured review.**

Annotation Outline is a desktop plugin for SiYuan Note. It collects highlights, text colors and underlines from your current document into a heading-based sidebar. Mark important passages while reading, then revisit them in context and click a card to return to the source.

[简体中文](README.md) · [Development and validation (Chinese)](docs/DEVELOPMENT.md)

![Annotation Outline overview](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/overview.png)

> Images were captured in an isolated SiYuan 3.8.10 test workspace, using the real editor, built-in themes and dedicated sample documents. Screenshots use SiYuan's desktop browser interface. Appearance varies with the SiYuan version and theme. Documentation images load from pinned GitHub URLs and require an internet connection.

## Features

- **Review by heading:** H1–H6 hierarchy, collapsible sections, search, style filters and navigation back to the source.
- **One-time or continuous annotation:** choose a style, apply it once, or keep selecting passages in continuous mode. Press `Esc` to exit.
- **Recognizable cards:** retain text colors, backgrounds and line effects from the source.
- **Follow your reading position:** click the crosshair to locate nearby annotations; double-click to lock automatic following, and double-click again to unlock.
- **Combined filters:** match tool features, exact styles, colors, line effects, formatting or sections. Combine AND/OR groups and exclusions with search.
- **Preview style changes:** replace one annotation from its context menu or change the entire document/current filtered results in a batch. Review counts and before/after examples before confirming.

Only the **current document** is indexed, rather than the whole notebook or workspace.

## 1. Choose a style and annotate

Open a document and the Annotation Outline dock on the right. Select a style in the toolbar.

- **Annotate once:** click “Annotate” to apply to an existing selection. Without a selection, the tool waits for your next selection and exits after one annotation.
- **Continuous annotation:** click “Continuous”, then select passages repeatedly. Switch styles while working. Press `Esc` or click the stop button to finish.

Choosing a style alone does not change an existing selection or enable continuous annotation. The dock's pen button opens a floating toolbar; the SiYuan top-bar button and shortcut can also toggle it.

![Choose a style and annotate](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/usage-01-annotate.png)

## 2. Review in context

Cards are organized under their headings. Empty branches are hidden. Search annotation text or heading names, combine search with a quick style filter, and click a card to return to the source.

The crosshair locates the annotation under the cursor or a nearby annotation in the same section. Double-click to enable automatic following. If filters hide the target, the plugin asks you to clear them without changing them automatically.

![Review, search and locate annotations](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/usage-02-outline.png)

## 3. Filter and change styles

Open “More filters” to create conditions and nested groups. Use AND/OR, matching and exclusions. Section conditions include child sections; the dialog previews the number of matches.

Open “Batch restyle” to choose a source style, target tool, replacement mode and scope. Review the actual change count and before/after examples, then confirm.

- **Use the target style completely:** replace annotation formatting with the target tool.
- **Preserve extra formatting:** replace colors, line effects and related annotation effects while preserving bold, italic, superscript/subscript and font settings; explicit target settings take priority.

You can also right-click a card to change it or prefill a batch for its exact style. A batch is saved as one native SiYuan undo operation. Preparation and validation can be canceled; once saving starts, wait for completion. Large batches take longer to save.

![Combined filters and batch previews](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/usage-03-filter-batch.png)

## 4. Sync SiYuan styles and combine effects

The sidebar and floating toolbar follow SiYuan’s native groups: Recently used, Styles, Text color, Background color and Text effects. Custom styles, names, ordering, visibility and light/dark colors sync from SiYuan. Manage global styles in SiYuan; choosing a style there does not change the plugin’s independently selected annotation style.

The first choice in Styles, Text color and Background color restores the native default for that group. The gear at the end of each group opens SiYuan’s color manager directly. Closing it returns to your filter or batch dialog with the unfinished settings preserved.

Select uniformly styled text, then click the plus in Combination tools to create a combination from its colors and text effects, preserving native color references and light/dark expressions. Adjust its name and effects before saving. Combinations appear as compact preview swatches; hover to see their names. Use the gear in the same section to manage tools and their order. Choosing a style selects it; use Annotate or Continuous annotation to apply it.

Editing a combination tool affects future actions. Editing a native color changes the appearance of all text referencing that style without rewriting the document. Use card replacement or batch changes to replace historical references. Saved formatting remains after uninstalling the plugin.

![Customize annotation tools](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/usage-04-tools.png)

## Native style search and light/dark appearances

Find by style and More filters use the same native library. Native style conditions match stable references, distinguishing different styles with identical colors. Color and Complete style conditions remain available for finding older fixed colors or matching visual appearance. Text search covers annotation content and headings in the current document, combined with style and section rules. Counts, result navigation and batch changes within filtered results share the same matches.

Native style changes sync automatically, including renaming, recoloring, sorting, hiding and deletion. The plugin remembers its own selected style. Hiding changes available choices; deleting the selected native style stops annotation and asks for a new choice. Sync failures keep the previous library and offer retry. Older hosts without the library API offer built-in styles and an update notice.

Existing fixed colors and light/dark expressions are preserved. Under **Migrate older styles → Repair old colors** in tool settings, explicitly map older tools or document colors to native SiYuan colors, preview, then confirm. Document repairs include unloaded annotations and support one native undo. Tool repairs retain the latest backup for restoration.


Third-party themes can produce different results.

![SiYuan built-in dark theme](https://cdn.jsdelivr.net/gh/lisontowind/sy-annotation@0.4.1/docs/assets/en/interface-dark.png)

## Installation and compatibility

Current version: **0.4.4**. Declared minimum SiYuan version: **3.2.0**. Native annotation, color management and default color restoration were validated in an isolated SiYuan **3.8.10** workspace. Chinese and English screenshots come from that workspace. Older versions without the native style library use built-in styles and show an update notice.

**Chinese and English interfaces are supported.** The plugin follows SiYuan's interface language. Change SiYuan's language and restart as prompted. The sidebar, toolbar, filters, batch changes, tool settings and messages are localized. Custom tool names and document content stay as you wrote them.

Supports desktop, desktop browser and desktop windows; dock support in separate windows depends on SiYuan. Mobile and PDF-canvas annotations are outside this version's scope. Cross-device synchronization, third-party themes and multiwindow combinations require further testing in your environment.

Search for “标注大纲” in Settings → Bazaar → Plugins. For manual installation:

1. Extract the release attachment `package.zip` into `data/plugins/sy-annotation/` in your workspace.
2. Keep `plugin.json`, `index.js`, `index-worker.js` and `index.css` directly inside that directory.
3. Enable the plugin in the downloaded-plugins tab. Disable before upgrading, replace files, then enable again.

Tool settings are stored in `data/storage/petal/sy-annotation/tools.json`. Continuous annotation and automatic following do not resume automatically after restart.

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Toggle floating toolbar | Alt + Shift + H | Option + Shift + H |
| Toggle continuous annotation | Ctrl + Alt + H | Cmd + Option + H |
| Annotate once | Alt + Shift + M | Option + Shift + M |
| Exit waiting / continuous mode | Esc | Esc |

## Scope

- Only editable document text can be annotated. Code/HTML/embed blocks, databases, inline formulas and read-only content are excluded.
- Plain bold or italic text is not collected by default. Recognizable colors, highlights, lines and combinations matching custom tools are collected.
- Contiguous segments with identical annotation styles merge within a block. Inline memos, links, block references and local superscripts/subscripts preserve their content, identities and scope without splitting an annotation. Uncolored links, references and scripts between matching styled segments also belong to the whole annotation. Other formatting differences such as color, bold or font size, ordinary unmarked text and block boundaries remain separate. The sidebar counts actual segments, which can differ from the number of annotation actions.
- No additional annotation service is required. The plugin reads the current document and saves native text formatting through SiYuan's APIs.

[Development and validation (Chinese)](docs/DEVELOPMENT.md) · [MIT License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
