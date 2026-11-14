import { t, toolLabel } from "./i18n";
import type { Annotation, AnnotationTool, Heading } from "./model";
import { appearanceOf, appearanceLabel, visualProperties, visualSignature, type ColorEnvironment } from "./appearance";
import { emptyRule, validRule, type FilterRule, type QueryRequest, type QueryResult, type AnnotationQuery, type RuleField } from "./filters";
import { button, element, icon, renderToolPreview } from "./ui";

export const ruleFields = (): [RuleField, string][] => [["tool", t("工具特征")], ["signature", t("完整样式")], ["color", t("文字颜色")], ["background-color", t("背景颜色")], ["line", t("划线形状")], ["strong", t("加粗")], ["em", t("斜体")], ["s", t("删除线")], ["sup", t("上标")], ["sub", t("下标")], ["shadow", t("阴影")], ["hollow", t("空心")], ["heading", t("标题章节")]];
export function selectOptions(options: [string, string][], value: string, change: (value: string) => void, className = "sya-text-input"): HTMLSelectElement {
  const select = element("select", className);
  for (const [id, label] of options) { const option = element("option", "", label); option.value = id; select.append(option); }
  select.value = value;
  select.addEventListener("change", () => change(select.value));
  return select;
}
export function styleChoices(annotations: Annotation[], env: ColorEnvironment): [string, string][] {
  const choices = new Map<string, string>();
  for (const a of annotations) {
    const key = visualSignature(appearanceOf(a), env);
    if (!choices.has(key)) choices.set(key, `${appearanceLabel(appearanceOf(a), env)}（${a.text.slice(0, 18)}${a.text.length > 18 ? "…" : ""}）`);
  }
  return [...choices];
}
export function appendAppearance(node: HTMLElement, annotation: Annotation): void {
  renderToolPreview(node, { ...appearanceOf(annotation), id: "", label: "", color: "" });
}
export class FilterDialog {
  readonly element = element("dialog", "sya-manager sya-filter-dialog");
  private body = element("div", "sya-dialog-body");
  private status = element("span", "sya-dialog-status");
  private apply: HTMLButtonElement;
  private rule: FilterRule;
  private version = 0;
  private closed = false;
  constructor(
    private annotations: Annotation[], private headings: Heading[], private tools: AnnotationTool[],
    private environment: ColorEnvironment, private rootId: string, private query: AnnotationQuery,
    private runQuery: (request: QueryRequest) => Promise<QueryResult>, private commit: (rule: FilterRule) => void,
  ) {
    this.rule = structuredClone(query.rule);
    const header = element("div", "sya-manager__header");
    header.append(element("strong", "", t("更多筛选")), button("sya-icon-button", t("关闭筛选面板"), icon("close"), () => this.close()));
    const footer = element("div", "sya-dialog-footer");
    this.apply = button("sya-button sya-primary sya-filter-apply", t("应用筛选"), t("应用"), () => { this.commit(this.rule); this.close(); });
    footer.append(button("sya-button", t("清空筛选规则"), t("清空"), () => { this.rule = emptyRule(); this.render(); }), this.status,
      button("sya-button", t("取消筛选"), t("取消"), () => this.close()), this.apply);
    this.element.append(header, element("p", "sya-dialog-intro", t("组内可选择并且／或者；标题条件包含子章节。规则与快捷样式、文字搜索共同生效。")), this.body, footer);
    this.element.addEventListener("cancel", () => this.close());
    document.body.append(this.element); this.element.showModal(); this.render();
  }
  private options(field: RuleField): [string, string][] {
    if (field === "tool") return this.tools.map((tool) => [tool.id, toolLabel(tool)]);
    if (field === "signature") return styleChoices(this.annotations, this.environment);
    if (field === "heading") return [["__intro__", t("文档开头")], ...this.headings.map((h): [string, string] => [h.id, `${"　".repeat(h.level - 1)}H${h.level} ${h.text}`])];
    if (field === "line") return [["__unset__", t("未设置")], ["solid", t("实线")], ["wavy", t("波浪线")], ["dotted", t("点线")], ["dashed", t("虚线")], ["double", t("双线")]];
    if (field === "color" || field === "background-color") {
      const values = new Set(this.annotations.map((a) => visualProperties(appearanceOf(a), this.environment)[field]).filter(Boolean));
      return [["__unset__", t("未设置")], ...[...values].map((v): [string, string] => [v, v])];
    }
    return [["yes", t("有")], ["no", t("无")]];
  }
  private render(): void {
    this.body.replaceChildren(this.renderRule(this.rule));
    void this.preview();
  }
  private renderRule(rule: FilterRule, remove?: () => void): HTMLElement {
    if (rule.kind === "group") {
      const group = element("div", "sya-rule-group");
      const head = element("div", "sya-rule-actions");
      head.append(selectOptions([["and", t("满足全部（并且）")], ["or", t("满足任一（或者）")]], rule.op, (value) => { rule.op = value as "and" | "or"; void this.preview(); }, "sya-text-input sya-rule-op"),
        button("sya-button sya-add-condition", t("添加条件"), t("+ 条件"), () => { rule.children.push({ kind: "condition", field: "tool", value: "", exclude: false }); this.render(); }),
        button("sya-button sya-add-group", t("添加条件组"), t("+ 分组"), () => { rule.children.push(emptyRule()); this.render(); }));
      if (remove) head.append(button("sya-icon-button", t("删除条件组"), "×", remove));
      group.append(head);
      if (!rule.children.length) group.append(element("p", "sya-rule-empty", t("没有条件，不限制结果")));
      rule.children.forEach((child, index) => group.append(this.renderRule(child, () => { rule.children.splice(index, 1); this.render(); })));
      return group;
    }
    const row = element("div", "sya-rule-condition");
    const field = selectOptions(ruleFields(), rule.field, (value) => { rule.field = value as RuleField; rule.value = ""; this.render(); }, "sya-text-input sya-rule-field");
    const comparison = selectOptions([["include", t("匹配")], ["exclude", t("排除")]], rule.exclude ? "exclude" : "include", (value) => { rule.exclude = value === "exclude"; void this.preview(); }, "sya-text-input sya-rule-comparison");
    const options: [string, string][] = [["", t("请选择…")], ...this.options(rule.field)];
    if (rule.value && !options.some(([key]) => key === rule.value)) options.push([rule.value, t("原条件（当前文档未出现）")]);
    const value = selectOptions(options, rule.value, (value) => { rule.value = value; void this.preview(); }, "sya-text-input sya-rule-value");
    row.append(field, comparison, value, button("sya-icon-button", t("删除筛选条件"), "×", remove!));
    return row;
  }
  private async preview(): Promise<void> {
    const version = ++this.version;
    this.apply.disabled = !validRule(this.rule);
    if (this.apply.disabled) { this.status.textContent = t("请补全条件"); return; }
    this.status.textContent = t("正在筛选…");
    try {
      const result = await this.runQuery({ rootId: this.rootId, version, environment: this.environment, query: { ...this.query, rule: structuredClone(this.rule) } });
      if (this.closed || version !== this.version || result.rootId !== this.rootId || result.version !== version) return;
      this.status.textContent = t("命中 {0} 处标注", result.keys.length);
    } catch { if (!this.closed && version === this.version) { this.status.textContent = t("文档已变化，请关闭后重试"); this.apply.disabled = true; } }
  }
  close(): void { this.closed = true; this.version++; this.element.remove(); }
}
