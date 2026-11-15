import type { AnnotationTool } from "./model";
import { t, toolLabel } from "./i18n";
import { nativeStyles, nativeDefaultGroup, nativeRef, nativeUnavailableMessage, type NativeStyleGroup } from "./native-styles";
import { button, element, icon, renderToolPreview } from "./ui";

interface PickerOptions {
  label?: string;
  groups?: NativeStyleGroup[];
  recent?: boolean;
  prefix?: [string, string][];
  context?: (tool: AnnotationTool, event: MouseEvent) => void;
  manageTools?: () => void;
  createTool?: () => void;
}
/** Shared SiYuan-shaped picker for painting, color fields, filtering and replacement. */
export class StylePicker {
  readonly element = element("details", "sya-style-picker");
  private summary = element("summary", "sya-style-picker__summary");
  private body = element("div", "sya-style-picker__body");
  private selected = "";
  private tools: AnnotationTool[] = [];
  private currentLabel?: string;
  private disposed = false;
  private outside = (event: Event) => { if (!this.element.contains(event.target as Node)) this.close(); };
  private escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.element.open) return;
    event.preventDefault(); event.stopPropagation(); this.close();
    this.summary.focus({ preventScroll: true });
  };
  private reposition = (event?: Event) => {
    if (event?.target instanceof Node && this.body.contains(event.target)) return;
    this.positionPopup();
  };
  constructor(private choose: (id: string) => void, private options: PickerOptions = {}) {
    this.summary.setAttribute("aria-label", options.label || t("思源样式"));
    if (typeof this.body.showPopover === "function") this.body.popover = "manual";
    this.element.append(this.summary, this.body);
    this.element.addEventListener("toggle", () => {
      this.unlisten();
      if (!this.element.open || this.disposed || !this.element.isConnected) return;
      for (const other of document.querySelectorAll<HTMLDetailsElement>("details.sya-style-picker[open]")) if (other !== this.element) other.open = false;
      const preview = this.summary.querySelector(".sya-picker-current")?.getAttribute("style");
      this.update(this.tools, this.selected, this.currentLabel);
      if (preview && !this.tools.some(tool => tool.id === this.selected)) this.summary.querySelector(".sya-picker-current")?.setAttribute("style", preview);
      // The top layer escapes dock/dialog clipping and the floating toolbar's transform.
      if (typeof this.body.showPopover === "function") {
        this.body.showPopover();
        this.positionPopup();
        window.addEventListener("resize", this.reposition);
        window.addEventListener("scroll", this.reposition, true);
      }
      document.addEventListener("pointerdown", this.outside, true);
      document.addEventListener("keydown", this.escape, true);
    });
  }
  update(tools: AnnotationTool[], selected = "", currentLabel?: string): void {
    this.tools = tools; this.currentLabel = currentLabel;
    this.element.dataset.value = selected;
    this.selected = selected; nativeStyles.applyScope(this.element);
    this.summary.replaceChildren(); this.body.replaceChildren();
    const current = tools.find(tool => tool.id === selected);
    const sample = element("span", "sya-picker-current", "A");
    if (current) renderToolPreview(sample, current);
    else if (!currentLabel) { sample.innerHTML = icon("styles"); sample.classList.add("is-placeholder"); }
    sample.setAttribute("aria-hidden", "true");
    const label = currentLabel || this.options.prefix?.find(([id]) => id === selected)?.[1] || (current ? toolLabel(current) :
      nativeRef(selected) ? nativeUnavailableMessage() : this.options.label || t("思源样式"));
    this.summary.title = label;
    const chevron = element("span", "sya-picker-chevron"); chevron.innerHTML = icon("down");
    this.summary.append(sample, element("span", "sya-picker-label", label), chevron);
    const status = element("div", "sya-style-picker__status");
    const message = nativeStyles.status === "ready" ? t("已同步思源") : nativeStyles.status === "loading" ? t("正在同步思源样式…") :
      nativeStyles.status === "fallback" ? t("当前宿主仅支持内置样式，请升级思源") : t("同步失败，保留上次样式");
    status.append(element("span", "", message), button("sya-icon-button sya-sync-styles", t("同步思源样式"), icon("refresh"), () => void nativeStyles.refresh()));
    if (nativeStyles.error) status.title = nativeStyles.error;
    this.body.append(status);
    if (this.options.prefix?.length) {
      const defaults = element("div", "sya-picker-defaults");
      for (const [id, text] of this.options.prefix) {
        const item = button("sya-button", text, "", () => this.select(id)); item.textContent = text;
        item.dataset.styleChoiceId = id;
        item.classList.toggle("is-selected", id === selected); defaults.append(item);
      }
      this.body.append(defaults);
    }
    if (this.options.recent !== false) this.section(t("最近使用"), nativeStyles.recent(tools));
    for (const [group, title] of [["style1", t("样式")], ["color", t("文字颜色")], ["backgroundColor", t("背景颜色")], ["effect", t("文字效果")]] as const) {
      if (this.options.groups && !this.options.groups.includes(group)) continue;
      this.section(title, tools.filter(tool => tool.nativeRef?.group === group && !tool.hidden), group);
    }
    this.section(t("组合工具"), tools.filter(tool => !tool.nativeRef), undefined, this.options.manageTools, this.options.createTool);
    if (current?.hidden) this.section(t("当前样式（已隐藏）"), [current]);
    this.body.append(element("p", "sya-picker-help", t("配色和样式在思源文字样式面板中管理")));
    this.positionPopup();
  }
  private section(title: string, tools: AnnotationTool[], group?: NativeStyleGroup, manageTools?: () => void, createTool?: () => void): void {
    if (!tools.length && !manageTools && !createTool) return;
    const section = element("section", "sya-picker-section");
    section.classList.toggle("sya-picker-section--combinations", tools.every(tool => !tool.nativeRef));
    if (group) section.dataset.styleGroup = group;
    const grid = element("div", "sya-picker-grid");
    section.append(element("div", "sya-picker-heading", title), grid);
    for (const tool of tools) {
      const swatch = button(`sya-swatch${tool.nativeRef ? " color__square sya-native-swatch" : " sya-combination-swatch"}`, toolLabel(tool), "", () => this.select(tool.id));
      swatch.classList.toggle("sya-default-swatch", !!nativeDefaultGroup(tool.nativeRef));
      swatch.dataset.toolId = tool.id;
      swatch.classList.toggle("is-selected", tool.id === this.selected);
      swatch.setAttribute("aria-pressed", String(tool.id === this.selected));
      const preview = element("span", "sya-swatch__sample", tool.nativeRef?.group === "backgroundColor" ? " " : "A");
      renderToolPreview(preview, tool); swatch.append(preview);
      if (!tool.nativeRef && this.options.context) swatch.addEventListener("contextmenu", event => { event.preventDefault(); this.close(); this.options.context!(tool, event); });
      grid.append(swatch);
    }
    if (group === "style1" || group === "color" || group === "backgroundColor") {
      const manage = button("sya-swatch sya-manage-native-colors", t("管理{0}", title), icon("settings"), () => {
        this.close(); this.summary.focus({ preventScroll: true }); nativeStyles.manageColors?.(group);
      });
      manage.dataset.nativeStyleGroup = group;
      manage.disabled = !nativeStyles.manageColors || nativeStyles.status === "fallback" || !!window.siyuan?.config?.readonly || !!window.siyuan?.isPublish;
      grid.append(manage);
    }
    if (createTool) {
      grid.append(button("sya-swatch sya-new-combination", t("按选中文本新建组合样式"), icon("plus"), () => {
        this.close(); createTool();
      }));
    }
    if (manageTools) {
      grid.append(button("sya-swatch sya-manage-tools", t("设置标注工具"), icon("settings"), () => {
        this.close(); this.summary.focus({ preventScroll: true }); manageTools();
      }));
    }
    this.body.append(section);
  }
  private positionPopup(): void {
    if (!this.body.popover || !this.body.matches(":popover-open")) return;
    const anchor = this.summary.getBoundingClientRect();
    const margin = 12, gap = 6;
    const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    const targetHeight = Math.min(380, this.body.scrollHeight + this.body.offsetHeight - this.body.clientHeight);
    const openAbove = below < targetHeight && above > below;
    this.body.style.setProperty("--sya-picker-max-height", `${Math.min(380, openAbove ? above : below)}px`);
    const bounds = this.body.getBoundingClientRect();
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - bounds.width - margin));
    const top = openAbove ? anchor.top - gap - bounds.height : anchor.bottom + gap;
    this.body.style.setProperty("--sya-picker-left", `${left}px`);
    this.body.style.setProperty("--sya-picker-top", `${Math.max(margin, top)}px`);
  }
  private unlisten(): void {
    document.removeEventListener("pointerdown", this.outside, true);
    document.removeEventListener("keydown", this.escape, true);
    window.removeEventListener("resize", this.reposition);
    window.removeEventListener("scroll", this.reposition, true);
    if (this.body.popover && this.body.matches(":popover-open")) this.body.hidePopover();
  }
  private close(): void { this.element.open = false; this.unlisten(); }
  private select(id: string): void { this.close(); this.choose(id); }
  destroy(): void { this.disposed = true; this.close(); this.element.remove(); }
}
