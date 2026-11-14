import { t, toolLabel } from "./i18n";
import {
  buildOutline,
  STYLES,
  type Annotation,
  type AnnotationTool,
  type Heading,
  type OutlineNode,
} from "./model";
import { VirtualList, type VirtualRow } from "./virtual-list";
import { appearanceOf as annotationAppearance, paintStrip, visibleColor, GRAY as DEFAULT_MARK_COLOR, MARK_BACKGROUND as NATIVE_MARK_BACKGROUND, readColorEnvironment } from "./appearance";
import { emptyQuery, QueryEngine, ruleCount, type AnnotationQuery, type QueryRequest, type QueryResult } from "./filters";
import { FilterDialog, selectOptions } from "./filter-dialog";
import type { ReplacementMode } from "./replacement";
export { visibleColor } from "./appearance";

const paths: Record<string, string> = {
  pen: '<path d="m15 4 5 5M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20Z"/><path d="M13 21h7"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 15.74-6.26L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.74 6.26L3 16M8 16H3v5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  outline: '<path d="M9 5h11M9 12h8M9 19h11M4 5h.01M4 12h.01M4 19h.01"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  collapse: '<path d="m7 8 5-5 5 5M7 16l5 5 5-5M5 12h14"/>',
  expand: '<path d="m7 3 5 5 5-5M7 21l5-5 5 5M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  locate:
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  lock: '<rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};
export function icon(name: string): string {
  const nativeId = name === "settings" ? "iconSettings" : name === "refresh" ? "iconRefresh" : undefined;
  if (nativeId && document.getElementById(nativeId))
    return `<svg class="sya-icon sya-icon--native" aria-hidden="true"><use href="#${nativeId}" xlink:href="#${nativeId}"></use></svg>`;
  return `<svg class="sya-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.pen}</svg>`;
}
export function toolAccentColor(
  tool: Pick<AnnotationTool, "marks" | "styles">,
): string {
  return (
    visibleColor(tool.styles.color) ||
    visibleColor(tool.styles["background-color"]) ||
    visibleColor(tool.styles["text-decoration-color"]) ||
    (tool.marks.includes("mark") ? NATIVE_MARK_BACKGROUND : DEFAULT_MARK_COLOR)
  );
}
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(
  className: string,
  label: string,
  html: string,
  callback: () => void,
): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.innerHTML = html;
  node.addEventListener("click", callback);
  return node;
}
export function renderToolPreview(
  node: HTMLElement,
  tool: AnnotationTool,
): void {
  node.removeAttribute("style");
  for (const [key, value] of Object.entries(tool.styles))
    node.style.setProperty(key, value);
  if (tool.marks.includes("strong") && !tool.styles["font-weight"]) node.style.fontWeight = "bold";
  if (tool.marks.includes("em") && !tool.styles["font-style"]) node.style.fontStyle = "italic";
  const lines = new Set(
    (node.style.textDecorationLine || "").split(" ").filter(Boolean),
  );
  if (tool.marks.includes("u")) lines.add("underline");
  if (tool.marks.includes("s")) lines.add("line-through");
  node.style.textDecorationLine = [...lines].join(" ");
  if (tool.marks.includes("mark") && !node.style.backgroundColor)
    node.style.backgroundColor = NATIVE_MARK_BACKGROUND;
  node.style.verticalAlign = tool.marks.includes("sup")
    ? "super"
    : tool.marks.includes("sub")
      ? "sub"
      : node.style.verticalAlign;
}
export interface UIActions {
  chooseStyle(id: string): void;
  apply(): void;
  toggleContinuous(): void;
  refresh(): void;
  navigate(id: string, annotation?: Annotation): void;
  closeToolbar(): void;
  manageTool(id?: string, create?: boolean): void;
  deleteTool(id: string): void;
  locate(): void;
  toggleFollow(): void;
  queryAnnotations?(request: QueryRequest): Promise<QueryResult>;
  replaceAnnotation?(annotation: Annotation, toolId: string, mode: ReplacementMode): Promise<void>;
  openBulk?(query: AnnotationQuery, annotation?: Annotation): void;
  getReplacementMode?(): ReplacementMode;
  setReplacementMode?(mode: ReplacementMode): void;
  showToolbar?(): void;
}
export class AnnotationToolbar {
  readonly element: HTMLElement;
  private palette = element("div", "sya-palette");
  private toggle: HTMLButtonElement;
  private current = element("span", "sya-tools__current");
  private counter = element("span", "sya-session-count");
  private dismissContext?: () => void;
  constructor(
    private actions: UIActions,
    floating = false,
  ) {
    this.element = element(
      "div",
      `sya-tools${floating ? " sya-tools--floating" : ""}`,
    );
    this.element.setAttribute("role", "toolbar");
    this.element.setAttribute("aria-label", t("标注工具栏"));
    this.enablePaletteScrolling();
    this.element.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );
    const caption = element("div", "sya-tools__caption");
    caption.innerHTML = t("{0}<span>标注工具</span>", icon("pen"));
    caption.append(this.current);
    if (!floating) this.element.append(caption);
    this.element.append(this.palette);
    const manager = element("div", "sya-tool-manager-buttons");
    manager.append(
      button("sya-icon-button sya-new-tool", t("新建标注工具"), icon("plus"), () =>
        actions.manageTool(undefined, true),
      ),
      button(
        "sya-icon-button sya-manage-tools",
        t("设置标注工具"),
        icon("settings"),
        () => actions.manageTool(),
      ),
    );
    this.element.append(manager);
    const controls = element("div", "sya-tools__controls");
    controls.append(
      button(
        "sya-button sya-apply",
        t("标注（有选区时立即应用，否则等待下一次划选）"),
        t("{0}<span>标注</span>", icon("pen")),
        actions.apply,
      ),
    );
    this.toggle = button(
      "sya-button sya-continuous",
      t("开启或结束连续标注"),
      "",
      actions.toggleContinuous,
    );
    controls.append(this.toggle, this.counter);
    this.element.append(controls);
    if (floating)
      this.element.append(
        button(
          "sya-icon-button",
          t("关闭工具栏并退出连续标注"),
          icon("close"),
          actions.closeToolbar,
        ),
      );
    else
      this.element.append(
        element("p", "sya-tools__hint", t("先选样式，再点击标注 · 右键编辑工具")),
      );
  }
  private enablePaletteScrolling(): void {
    const palette = this.palette;
    palette.title = t("滚轮或左右拖动查看更多样式");
    palette.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey || palette.scrollWidth <= palette.clientWidth)
          return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
        if (!delta) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? palette.clientWidth : 1;
        palette.scrollLeft += delta * unit;
        event.preventDefault();
      },
      { passive: false },
    );
    let drag: { id: number; x: number; left: number; moved: boolean } | undefined;
    let suppressClick = false;
    palette.addEventListener("pointerdown", (event) => {
      suppressClick = false;
      if (event.button !== 0 || event.pointerType === "touch" || palette.scrollWidth <= palette.clientWidth)
        return;
      drag = { id: event.pointerId, x: event.clientX, left: palette.scrollLeft, moved: false };
    });
    palette.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const distance = event.clientX - drag.x;
      if (!drag.moved && Math.abs(distance) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        suppressClick = true;
        palette.setPointerCapture(event.pointerId);
        palette.classList.add("is-dragging");
      }
      palette.scrollLeft = drag.left - distance;
      event.preventDefault();
    });
    const finish = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      if (palette.hasPointerCapture(event.pointerId))
        palette.releasePointerCapture(event.pointerId);
      palette.classList.remove("is-dragging");
      drag = undefined;
    };
    palette.addEventListener("pointerup", finish);
    palette.addEventListener("pointercancel", finish);
    palette.addEventListener("lostpointercapture", finish);
    palette.addEventListener("pointerleave", (event) => {
      if (!drag?.moved) finish(event);
    });
    palette.addEventListener("click", (event) => {
      if (!suppressClick || !event.detail) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }, true);
  }
  update(
    styleId: string,
    continuous: boolean,
    count: number,
    tools: AnnotationTool[] = STYLES,
    singleShot = false,
  ): void {
    this.palette.replaceChildren();
    for (const tool of tools) {
      const swatch = button("sya-swatch", toolLabel(tool), "", () =>
        this.actions.chooseStyle(tool.id),
      );
      swatch.dataset.toolId = tool.id;
      swatch.style.setProperty("--sya-swatch", toolAccentColor(tool));
      const sample = element("span", "sya-swatch__sample", "Aa");
      renderToolPreview(sample, tool);
      swatch.append(sample);
      swatch.classList.toggle("is-selected", tool.id === styleId);
      swatch.classList.toggle("is-painting", tool.id === styleId && (continuous || singleShot));
      swatch.setAttribute(
        "aria-pressed",
        String(tool.id === styleId),
      );
      swatch.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.showContext(tool, event);
      });
      this.palette.append(swatch);
    }
    this.current.textContent =
      toolLabel(tools.find((tool) => tool.id === styleId)) || t("尚无工具");
    this.toggle.classList.toggle("is-active", continuous);
    this.toggle.setAttribute("aria-pressed", String(continuous));
    this.toggle.innerHTML = t("{0}<span>{1}</span>", icon(continuous ? "stop" : "pen"), continuous ? t("结束标注") : t("连续标注"));
    this.counter.textContent = continuous && count ? t("本次 {0} 处", count) : "";
    const apply = this.element.querySelector<HTMLButtonElement>(".sya-apply")!;
    apply.classList.toggle("is-active", singleShot);
    apply.setAttribute("aria-pressed", String(singleShot));
    const hint = this.element.querySelector(".sya-tools__hint");
    if (hint)
      hint.textContent = singleShot
        ? t("请划选一处文字 · 完成后退出 · 按 Esc 取消")
        : continuous
        ? t("选中文字即标注 · 按 Esc 退出")
        : t("先选样式，再点击标注 · 右键编辑工具");
  }
  private showContext(tool: AnnotationTool, event: MouseEvent): void {
    this.dismissContext?.();
    const menu = element("div", "sya-tool-context");
    menu.setAttribute("role", "menu");
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 170)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 100)}px`;
    menu.append(
      button("sya-context-item", t("编辑工具"), t("编辑工具"), () => {
        this.dismissContext?.();
        this.actions.manageTool(tool.id);
      }),
      button("sya-context-item", t("删除工具"), t("删除工具"), () => {
        this.dismissContext?.();
        this.actions.deleteTool(tool.id);
      }),
    );
    const close = (e: Event) => {
      if (!menu.contains(e.target as Node)) this.dismissContext?.();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.dismissContext?.();
    };
    this.dismissContext = () => {
      menu.remove();
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      this.dismissContext = undefined;
    };
    document.body.append(menu);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
  }
  destroy(): void {
    this.dismissContext?.();
    this.element.remove();
  }
}
export class AnnotationPanel {
  readonly element: HTMLElement;
  readonly toolbar: AnnotationToolbar;
  private title: HTMLElement;
  private count: HTMLElement;
  private tree: HTMLElement;
  private status: HTMLElement;
  private search: HTMLInputElement;
  private filter: HTMLSelectElement;
  private collapseButton: HTMLButtonElement;
  private locateButton: HTMLButtonElement;
  private annotations: Annotation[] = [];
  private collapsed = new Set<string>();
  private documentId = "";
  private error = "";
  private filteredCollapsed = new Set<string>();
  private virtual: VirtualList;
  private currentHeading = "";
  private currentAnnotation = "";
  private locatedKey = "";
  private tools = STYLES;
  private query: AnnotationQuery = emptyQuery();
  private sessionFilters = new Map<string, AnnotationQuery>();
  private filtered: Annotation[] = [];
  private queryVersion = 0;
  private headings: Heading[] = [];
  private moreFilter: HTMLButtonElement;
  private filterDialog?: FilterDialog;
  private dismissCardMenu?: () => void;
  private destroyed = false;
  private outlineSource?: Annotation[];
  private cachedOutline?: OutlineNode;
  private allHeadingIds = new Set<string>();
  private filteredHeadingIds = new Set<string>();
  private filteredAnnotationKeys = new Set<string>();
  constructor(private actions: UIActions) {
    this.element = element("section", "sya-panel");
    this.element.setAttribute("aria-label", t("标注大纲"));
    const header = element("div", "block__icons sya-header");
    header.addEventListener("mousedown", (event) => { if ((event.target as Element).closest(".sya-show-toolbar")) event.preventDefault(); });
    const brand = element("div", "block__logo");
    brand.innerHTML = t("{0}<span>标注大纲</span>", icon("outline"));
    const min = element("span", "block__icon");
    min.dataset.type = "min";
    min.title = t("收起侧栏");
    min.innerHTML = '<svg><use href="#iconMin"></use></svg>';
    header.append(
      brand,
      element("span", "fn__flex-1"),
      button("sya-icon-button", t("刷新标注"), icon("refresh"), actions.refresh),
      button("sya-icon-button sya-show-toolbar", t("显示标注工具栏"), icon("pen"), () => actions.showToolbar?.()),
      min,
    );
    this.element.append(header);
    const documentInfo = element("div", "sya-document");
    documentInfo.append(element("div", "sya-eyebrow", t("当前文档")));
    this.title = element("h2", "sya-document__title", t("打开文档开始阅读"));
    this.count = element("span", "sya-document__count", "0");
    const titleLine = element("div", "sya-document__line");
    titleLine.append(this.title, this.count);
    documentInfo.append(titleLine);
    this.element.append(documentInfo);
    this.toolbar = new AnnotationToolbar(actions);
    this.element.append(this.toolbar.element);
    const filters = element("div", "sya-filters");
    const searchWrap = element("label", "sya-search");
    searchWrap.innerHTML = icon("search");
    this.search = element("input", "sya-search__input");
    this.search.type = "search";
    this.search.placeholder = t("搜索标注或标题…");
    this.search.setAttribute("aria-label", t("搜索标注或标题"));
    this.search.addEventListener("input", () => {
      this.filteredCollapsed.clear();
      this.query.search = this.search.value;
      this.requestFilter(true);
    });
    searchWrap.append(this.search);
    this.filter = element("select", "sya-style-filter");
    this.filter.setAttribute("aria-label", t("筛选标注样式"));
    this.filter.addEventListener("change", () => {
      this.filteredCollapsed.clear();
      this.query.quick = this.filter.value;
      this.requestFilter(true);
    });
    const filterActions = element("div", "sya-filter-actions");
    this.moreFilter = button("sya-button sya-more-filters", t("更多筛选"), t("更多筛选"), () => this.openFilters());
    filterActions.append(this.filter, this.moreFilter, button("sya-button sya-open-bulk", t("批量改样式"), t("批量改样式"), () => this.actions.openBulk?.(structuredClone(this.query))));
    filters.append(searchWrap, filterActions);
    this.element.append(filters);
    const treeLabel = element("div", "sya-tree-label");
    this.status = element("span", "", t("文档标注"));
    this.locateButton = button(
      "sya-icon-button sya-locate",
      t("定位当前位置；双击锁定自动跟随"),
      icon("locate"),
      () => actions.locate(),
    );
    this.locateButton.addEventListener("mousedown", (event) => event.preventDefault());
    this.locateButton.addEventListener("dblclick", (event) => {
      event.preventDefault();
      actions.toggleFollow();
    });
    this.collapseButton = button(
      "sya-icon-button",
      t("折叠全部标题"),
      icon("collapse"),
      () => {
        const collapsed = this.collapseState();
        if (collapsed.size) collapsed.clear();
        else
          for (const annotation of this.annotations)
            for (const heading of annotation.headings)
              collapsed.add(heading.id);
        this.renderTree();
      },
    );
    treeLabel.append(
      this.status,
      element("span", "fn__flex-1"),
      this.locateButton,
      this.collapseButton,
    );
    this.element.append(treeLabel);
    this.tree = element("div", "sya-tree");
    this.element.append(this.tree);
    this.virtual = new VirtualList(this.tree);
    this.setTools(STYLES);
    this.renderTree();
  }
  setTools(tools: AnnotationTool[]): void {
    this.tools = tools;
    const selected = this.filter.value || "all";
    this.filter.replaceChildren();
    for (const [id, label] of [
      ["all", t("全部样式")],
      ...tools.map((tool) => [tool.id, toolLabel(tool)]),
      ["other", t("其他样式")],
    ]) {
      const option = element("option", "", label);
      option.value = id;
      this.filter.append(option);
    }
    this.filter.value = [...this.filter.options].some(
      (option) => option.value === selected,
    )
      ? selected
      : "all";
    this.query.quick = this.filter.value;
    if (this.virtual) this.requestFilter();
  }
  setFollow(value: boolean): void {
    this.locateButton.classList.toggle("is-locked", value);
    this.locateButton.setAttribute("aria-pressed", String(value));
    this.locateButton.innerHTML = icon(value ? "lock" : "locate");
    this.locateButton.title = value
      ? t("已锁定自动跟随；单击定位，双击解除")
      : t("定位当前位置；双击锁定自动跟随");
    this.locateButton.setAttribute("aria-label", this.locateButton.title);
  }
  setDocument(id: string, title: string): void {
    if (id !== this.documentId) {
      if (this.documentId) this.sessionFilters.set(this.documentId, structuredClone(this.query));
      this.filterDialog?.close();
      this.dismissCardMenu?.();
      this.documentId = id;
      this.annotations = [];
      this.filtered = [];
      this.headings = [];
      this.queryVersion++;
      this.query = structuredClone(this.sessionFilters.get(id) ?? emptyQuery());
      if (this.query.quick !== "all" && this.query.quick !== "other" && !this.tools.some((t) => t.id === this.query.quick)) this.query.quick = "all";
      this.search.value = this.query.search;
      this.filter.value = this.query.quick;
      this.collapsed.clear();
      this.filteredCollapsed.clear();
      this.error = "";
      this.currentHeading = "";
      this.currentAnnotation = "";
      this.locatedKey = "";
      this.renderTree(true);
      this.updateFilterButton();
    }
    if (this.title.textContent !== (title || t("未命名文档"))) this.title.textContent = title || t("未命名文档");
    if (this.title.title !== title) this.title.title = title;
  }
  setLoading(): void {
    this.status.textContent = t("正在建立全文索引…");
    this.tree.setAttribute("aria-busy", "true");
  }
  setAnnotations(annotations: Annotation[], headings?: Heading[]): void {
    this.annotations = annotations;
    this.allHeadingIds = new Set(annotations.flatMap((a) => a.headings.map((h) => h.id)));
    this.headings = headings ?? [...new Map(annotations.flatMap((a) => a.headings).map((h) => [h.id, h])).values()];
    this.error = "";
    this.tree.removeAttribute("aria-busy");
    this.requestFilter();
  }
  setError(message: string): void {
    this.error = message;
    this.tree.removeAttribute("aria-busy");
    this.renderTree();
  }
  locate(path: Heading[], following = false, annotation?: Annotation, highlight = true): "located" | "filtered" | "empty" {
    const target = [...path].reverse().find((heading) => this.allHeadingIds.has(heading.id));
    const annotationKey = annotation && highlight ? annotation.key : "";
    const sameSelection = this.currentAnnotation === annotationKey;
    this.currentAnnotation = annotationKey;
    if (!target && !annotation) { this.updateCurrentCards(); return "empty"; }
    if (annotation ? !this.filteredAnnotationKeys.has(annotation.key) : !this.filteredHeadingIds.has(target!.id)) {
      this.updateCurrentCards(); return "filtered";
    }
    const headingId = target?.id ?? "";
    const locationKey = annotation?.key ?? `h:${headingId}`;
    const sameTarget = this.locatedKey === locationKey;
    const needsExpand = path.some((heading) => this.collapsed.has(heading.id) || this.filteredCollapsed.has(heading.id));
    const sameHeading = this.currentHeading === headingId;
    if (following && sameHeading && sameTarget && sameSelection && !needsExpand) return "located";
    for (const heading of path) {
      this.collapsed.delete(heading.id);
      this.filteredCollapsed.delete(heading.id);
    }
    this.currentHeading = headingId;
    this.locatedKey = locationKey;
    if (needsExpand || !sameHeading) this.renderTree();
    if (!following || !sameTarget || needsExpand || !sameHeading) this.virtual.scrollToKey(locationKey);
    this.updateCurrentCards();
    return "located";
  }
  private updateCurrentCards(): void {
    for (const card of this.tree.querySelectorAll<HTMLElement>(".sya-card"))
      this.markCurrentCard(card, card.dataset.annotationKey === this.currentAnnotation);
  }
  private markCurrentCard(card: HTMLElement, current: boolean): void {
    card.classList.toggle("is-current", current);
    if (current) card.setAttribute("aria-current", "location");
    else card.removeAttribute("aria-current");
  }
  private renderTree(reset = false): void {
    const collapsed = this.collapseState();
    if (this.outlineSource !== this.filtered) {
      this.outlineSource = this.filtered;
      this.cachedOutline = buildOutline(this.filtered);
      this.filteredHeadingIds = new Set(this.filtered.flatMap((a) => a.headings.map((h) => h.id)));
      this.filteredAnnotationKeys = new Set(this.filtered.map((a) => a.key));
    }
    const outline = this.cachedOutline!;
    this.count.textContent = String(this.annotations.length);
    this.status.textContent =
      this.isFiltered()
        ? t("找到 {0} 处标注", outline.count)
        : t("{0} 处标注", this.annotations.length);
    this.collapseButton.innerHTML = icon(
      collapsed.size ? "expand" : "collapse",
    );
    this.collapseButton.title = collapsed.size
      ? t("展开全部标题")
      : t("折叠全部标题");
    this.collapseButton.setAttribute("aria-label", this.collapseButton.title);
    const rows: VirtualRow[] = [];
    if (this.error || !outline.count) {
      rows.push({
        key: "empty",
        version: `${this.error}|${this.annotations.length}`,
        estimate: 220,
        render: () => {
          const empty = element("div", "sya-empty");
          const graphic = element("div", "sya-empty__graphic");
          graphic.innerHTML = icon(this.error ? "refresh" : "pen");
          empty.append(
            graphic,
            element(
              "strong",
              "",
              this.error
                ? t("暂时无法读取标注")
                : this.annotations.length
                  ? t("没有匹配的标注")
                  : t("让值得记住的文字留下来"),
            ),
            element(
              "p",
              "",
              this.error ||
                (this.annotations.length
                  ? t("试试其他关键词或样式")
                  : t("选择样式，再点击标注或连续标注")),
            ),
          );
          if (this.error)
            empty.append(
              button(
                "sya-button",
                t("重新读取标注"),
                t("重试"),
                this.actions.refresh,
              ),
            );
          return empty;
        },
      });
    } else {
      const cards = (annotations: Annotation[], depth: number) => {
        for (const annotation of annotations)
          rows.push({
            key: annotation.key,
            version: annotation,
            estimate: 60,
            render: () => this.annotationCard(annotation, depth),
          });
      };
      if (outline.annotations.length) {
        rows.push({
          key: "intro",
          version: "intro",
          estimate: 30,
          render: () => element("div", "sya-unsectioned", t("文档开头")),
        });
        cards(outline.annotations, 0);
      }
      const visit = (node: OutlineNode, depth: number) => {
        const heading = node.heading!;
        rows.push({
          key: `h:${heading.id}`,
          version: `${heading.level}|${heading.text}|${node.count}|${depth}|${collapsed.has(heading.id)}|${heading.id === this.currentHeading}`,
          estimate: 34,
          render: () => this.headingRow(node, depth),
        });
        if (!collapsed.has(heading.id)) {
          cards(node.annotations, depth + 1);
          for (const child of node.children) visit(child, depth + 1);
        }
      };
      for (const child of outline.children) visit(child, 0);
    }
    this.virtual.setRows(rows, reset);
  }
  private headingRow(node: OutlineNode, depth: number): HTMLElement {
    const heading = node.heading!;
    const row = element(
      "div",
      `sya-heading${heading.id === this.currentHeading ? " is-current" : ""}`,
    );
    row.style.paddingLeft = `${Math.min(depth, 5) * 10}px`;
    const state = this.collapseState();
    const collapsed = state.has(heading.id);
    const toggle = button(
      `sya-heading__toggle${collapsed ? " is-collapsed" : ""}`,
      collapsed ? t("展开标题") : t("折叠标题"),
      icon("chevron"),
      () => {
        if (state.has(heading.id)) state.delete(heading.id);
        else state.add(heading.id);
        this.renderTree();
      },
    );
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const link = button(
      "sya-heading__link",
      t("跳转到 H{0}：{1}", heading.level, heading.text),
      "",
      () => this.actions.navigate(heading.id),
    );
    link.append(
      element("span", "sya-level", `H${heading.level}`),
      element("span", "sya-heading__text", heading.text),
    );
    row.append(
      toggle,
      link,
      element("span", "sya-heading__count", String(node.count)),
    );
    return row;
  }
  private annotationCard(annotation: Annotation, depth: number): HTMLElement {
    const card = button(
      "sya-card",
      `${toolLabel({ id: annotation.styleId, label: annotation.label })}: ${annotation.text}`,
      "",
      () => this.actions.navigate(annotation.blockId, annotation),
    );
    const appearance = annotationAppearance(annotation);
    card.dataset.annotationKey = annotation.key;
    this.markCurrentCard(card, annotation.key === this.currentAnnotation);
    paintStrip(card, appearance);
    card.style.setProperty("--sya-mark", toolAccentColor(appearance));
    card.style.marginLeft = `${Math.min(depth, 5) * 10}px`;
    card.style.width = `calc(100% - ${Math.min(depth, 5) * 10}px)`;
    const text = element("span", "sya-card__text");
    const sample = element("span", "sya-card__sample", annotation.text);
    renderToolPreview(sample, {
      id: annotation.styleId,
      label: annotation.label,
      color: toolAccentColor(appearance),
      ...appearance,
    });
    text.append(sample);
    card.append(text);
    card.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); this.openCardMenu(annotation, event); });
    return card;
  }
  destroy(): void {
    this.destroyed = true;
    this.queryVersion++;
    this.filterDialog?.close();
    this.dismissCardMenu?.();
    this.virtual.destroy();
    this.toolbar.destroy();
    this.element.remove();
  }
  private collapseState(): Set<string> {
    return this.isFiltered()
      ? this.filteredCollapsed
      : this.collapsed;
  }
  private isFiltered(): boolean { return !!this.query.search.trim() || this.query.quick !== "all" || ruleCount(this.query.rule) > 0; }
  private updateFilterButton(): void {
    const count = ruleCount(this.query.rule);
    this.moreFilter.textContent = count ? t("更多筛选 · {0}", count) : t("更多筛选");
    this.moreFilter.classList.toggle("is-active", count > 0);
    this.moreFilter.setAttribute("aria-pressed", String(count > 0));
  }
  private runQuery = (request: QueryRequest): Promise<QueryResult> => {
    return this.actions.queryAnnotations?.(request) ?? Promise.resolve({ rootId: request.rootId, version: request.version, keys: new QueryEngine(this.tools, request.environment).select(this.annotations, request.query).map((a) => a.key) });
  };
  private requestFilter(reset = false): void {
    const version = ++this.queryVersion;
    this.updateFilterButton();
    if (!this.isFiltered()) {
      this.filtered = this.annotations;
      this.renderTree(reset);
      this.tree.removeAttribute("aria-busy");
      return;
    }
    if (!this.actions.queryAnnotations || !this.annotations.length) {
      // Lightweight synchronous fallback for isolated UI hosts without a Worker.
      const env = typeof getComputedStyle === "undefined" ? {} : readColorEnvironment();
      this.filtered = new QueryEngine(this.tools, env).select(this.annotations, this.query);
      this.renderTree(reset);
      this.tree.removeAttribute("aria-busy");
      return;
    }
    const rootId = this.documentId;
    this.tree.setAttribute("aria-busy", "true");
    void this.runQuery({ rootId, version, environment: readColorEnvironment(), query: structuredClone(this.query) }).then((result) => {
      if (this.destroyed || version !== this.queryVersion || rootId !== this.documentId || result.rootId !== rootId || result.version !== version) return;
      const keys = new Set(result.keys);
      this.filtered = this.annotations.filter((a) => keys.has(a.key));
      this.renderTree(reset);
      this.tree.removeAttribute("aria-busy");
    }).catch((error) => { if (!this.destroyed && version === this.queryVersion) this.setError(error instanceof Error ? error.message : t("筛选失败")); });
  }
  private openFilters(): void {
    this.filterDialog?.close();
    this.filterDialog = new FilterDialog(this.annotations, this.headings, this.tools, readColorEnvironment(), this.documentId, this.query, this.runQuery, (rule) => {
      this.query.rule = structuredClone(rule); this.filteredCollapsed.clear(); this.requestFilter(true);
    });
  }
  private openCardMenu(annotation: Annotation, event: MouseEvent): void {
    this.dismissCardMenu?.();
    const menu = element("div", "sya-tool-context sya-card-context");
    menu.setAttribute("role", "menu");
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 280))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 360))}px`;
    menu.addEventListener("mousedown", (e) => { if ((e.target as Element).closest("button")) e.preventDefault(); });
    let mode = this.actions.getReplacementMode?.() ?? "replace";
    menu.append(element("strong", "sya-context-heading", t("更改样式")), selectOptions([["replace", t("完全采用目标样式")], ["preserve", t("保留额外格式")]], mode, (value) => {
      mode = value as ReplacementMode; this.actions.setReplacementMode?.(mode);
    }, "sya-text-input sya-replace-mode"));
    const list = element("div", "sya-context-tools");
    for (const tool of this.tools) {
      const item = button("sya-context-item sya-replace-tool", t("改为 {0}", toolLabel(tool)), "", () => {
        this.dismissCardMenu?.();
        void this.actions.replaceAnnotation?.(annotation, tool.id, mode);
      });
      item.dataset.toolId = tool.id;
      const sample = element("span", "sya-swatch__sample", "Aa"); renderToolPreview(sample, tool);
      item.append(sample, element("span", "", toolLabel(tool))); list.append(item);
    }
    if (!this.tools.length) list.append(element("p", "", t("请先新建标注工具")));
    menu.append(list, button("sya-context-item sya-bulk-same", t("批量修改相同样式"), t("批量修改相同样式…"), () => {
      this.dismissCardMenu?.(); this.actions.openBulk?.(structuredClone(this.query), annotation);
    }));
    const outside = (e: Event) => { if (!menu.contains(e.target as Node)) this.dismissCardMenu?.(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); this.dismissCardMenu?.(); } };
    this.dismissCardMenu = () => { menu.remove(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); this.dismissCardMenu = undefined; };
    document.body.append(menu); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
  }
}
export function createEditorIndicator(
  label: string,
  count: number,
  stop: () => void,
  singleShot = false,
): HTMLElement {
  const node = element("div", "sya-editor-indicator");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.innerHTML = t("<span class=\"sya-live-dot\"></span><strong>{0}</strong>", singleShot ? t("请划选一处文字，完成后退出") : t("正在连续标注"));
  node.append(element("span", "sya-editor-indicator__style", label));
  if (count)
    node.append(
      element("span", "sya-editor-indicator__count", t("本次 {0} 处", count)),
    );
  const exit = button(
    "sya-indicator-exit",
    singleShot ? t("取消本次标注") : t("结束连续标注"),
    t("<span>退出</span><kbd>Esc</kbd>"),
    stop,
  );
  exit.addEventListener("mousedown", (event) => event.preventDefault());
  node.append(exit);
  return node;
}
