import { nativeStyles } from "./native-styles";
import { StylePicker } from "./style-picker";
import { t } from "./i18n";
import type { Annotation, AnnotationTool } from "./model";
import { appearanceOf, visualSignature, type ColorEnvironment } from "./appearance";
import type { AnnotationQuery } from "./filters";
import { replacedAppearance, type ReplacementMode, type ReplacementPlan, type ProgressReporter } from "./replacement";
import { BatchProgressView } from "./batch-progress";
import { selectOptions, styleChoices } from "./filter-dialog";
import { button, element, icon, renderAnnotationPreview, renderToolPreview } from "./ui";

export interface BatchSpec { sourceKind: "tool" | "signature"; source: string; targetId: string; scope: "document" | "filtered"; query: AnnotationQuery; mode: ReplacementMode; }
export class ReplacementDialog {
  readonly element = element("dialog", "sya-manager sya-replacement-dialog");
  private controls = element("div", "sya-batch-controls");
  private examples = element("div", "sya-batch-examples");
  private status = element("div", "sya-dialog-status");
  private progress = new BatchProgressView();
  private execute: HTMLButtonElement;
  private cancel: HTMLButtonElement;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private plan?: ReplacementPlan;
  private closed = false;
  private committing = false;
  private sequence = 0;
  private pickers: StylePicker[] = [];
  private spec: BatchSpec;
  constructor(private annotations: Annotation[], private tools: AnnotationTool[], private environment: ColorEnvironment, query: AnnotationQuery,
    mode: ReplacementMode, annotation: Annotation | undefined,
    private prepare: (spec: BatchSpec, signal: AbortSignal, progress: ProgressReporter) => Promise<ReplacementPlan>,
    private commit: (plan: ReplacementPlan, signal: AbortSignal, progress: ProgressReporter) => Promise<void>,
    private modeChanged: (mode: ReplacementMode) => void) {
    const initial = query.quick !== "all" && query.quick !== "other" ? query.quick : tools.find(tool => tool.id === "native:backgroundColor:12")?.id || tools[0]?.id || "";
    this.spec = { sourceKind: annotation ? "signature" : "tool", source: annotation ? visualSignature(appearanceOf(annotation)) : initial, targetId: initial, scope: "document", query: structuredClone(query), mode };
    const header = element("div", "sya-manager__header");
    const heading = element("div", "sya-dialog-heading");
    heading.append(element("strong", "", t("批量改样式")), element("p", "sya-dialog-intro", t("仅修改当前文档。全文包含未加载的标注；筛选结果不受标题折叠影响。")));
    header.append(heading, button("sya-icon-button sya-batch-close", t("关闭批量修改"), icon("close"), () => this.close()));
    this.element.setAttribute("aria-label", t("批量改样式"));
    this.status.setAttribute("role", "status");
    const preview = element("section", "sya-batch-preview");
    preview.append(element("strong", "sya-section-title", t("修改预览")), this.status, this.progress.element, this.examples);
    const body = element("div", "sya-dialog-body"); body.append(this.controls, preview);
    const footer = element("div", "sya-dialog-footer");
    this.cancel = button("sya-button", t("取消批量修改"), t("取消"), () => this.close());
    this.execute = button("sya-button sya-primary sya-batch-execute", t("执行批量修改"), t("修改 0 处"), () => void this.submit());
    footer.append(element("span", "sya-dialog-note", t("整批修改可在正文中一次撤销")), this.cancel, this.execute); this.element.append(header, body, footer);
    this.element.addEventListener("cancel", (event) => { event.preventDefault(); this.close(); });
    nativeStyles.applyScope(this.element); document.body.append(this.element); this.element.showModal(); this.renderControls(); this.schedule();
  }
  private renderControls(): void {
    for (const picker of this.pickers) picker.destroy(); this.pickers = [];
    this.controls.replaceChildren();
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const row = element("div", "sya-form-field");
      row.append(element("span", "sya-field-label", label), control);
      (control.querySelector("summary") || control).setAttribute("aria-label", label);
      return row;
    };
    const styles = element("div", "sya-batch-styles");
    const source = element("section", "sya-batch-style-card");
    const target = element("section", "sya-batch-style-card");
    source.append(element("strong", "sya-section-title", t("查找样式")));
    target.append(element("strong", "sya-section-title", t("替换为")));
    source.append(field(t("匹配方式"), selectOptions([["tool", t("按工具特征")], ["signature", t("按完整样式")]], this.spec.sourceKind, (value) => {
      this.spec.sourceKind = value as BatchSpec["sourceKind"]; this.spec.source = ""; this.renderControls(); this.schedule();
    }, "sya-text-input sya-batch-source-kind")));
    const makePicker = (value: string, className: string, label: string, change: (id: string) => void) => {
      const picker = new StylePicker(id => { change(id); picker.update(this.tools, id); this.schedule(); }, { label });
      this.pickers.push(picker);
      picker.update(this.tools, value); picker.element.classList.add(className); return picker.element;
    };
    source.append(field(t("源样式"), this.spec.sourceKind === "tool" ? makePicker(this.spec.source, "sya-batch-source", t("请选择源样式…"), id => { this.spec.source = id; }) :
      selectOptions([["", t("请选择源样式…")], ...styleChoices(this.annotations, this.environment)], this.spec.source, value => { this.spec.source = value; this.schedule(); }, "sya-text-input sya-batch-source")));
    const sample = element("span", "sya-batch-target-sample", t("把值得记住的文字留下来 Aa"));
    const updateSample = () => {
      const tool = this.tools.find(tool => tool.id === this.spec.targetId);
      sample.removeAttribute("style"); if (tool) renderToolPreview(sample, tool);
    };
    target.append(field(t("目标样式"), makePicker(this.spec.targetId, "sya-batch-target", t("选择目标样式"), id => { this.spec.targetId = id; updateSample(); })));
    const sampleWrap = element("div", "sya-batch-target-preview"); sampleWrap.append(sample); target.append(sampleWrap); updateSample();
    const arrow = element("span", "sya-batch-arrow"); arrow.innerHTML = icon("arrow"); arrow.setAttribute("aria-hidden", "true");
    styles.append(source, arrow, target);
    const options = element("div", "sya-batch-options");
    const help = element("p", "sya-mode-help");
    const updateHelp = () => { help.textContent = this.spec.mode === "preserve"
      ? t("保留额外格式：替换颜色、划线、删除线、阴影和空心；保留加粗、斜体、上下标及字体字号，目标工具设置优先。")
      : t("完全采用目标样式，将匹配的标注统一为所选样式。"); };
    options.append(field(t("修改范围"), selectOptions([["document", t("当前文档全文")], ["filtered", t("当前筛选结果")]], this.spec.scope, (value) => { this.spec.scope = value as BatchSpec["scope"]; this.schedule(); }, "sya-text-input sya-batch-scope")),
      field(t("替换模式"), selectOptions([["replace", t("完全采用目标样式")], ["preserve", t("保留额外格式")]], this.spec.mode, (value) => { this.spec.mode = value as ReplacementMode; this.modeChanged(this.spec.mode); updateHelp(); this.schedule(); }, "sya-text-input sya-batch-mode")));
    updateHelp(); this.controls.append(styles, options, help);
  }
  private schedule(): void {
    clearTimeout(this.timer); this.controller?.abort(); this.sequence++; this.plan = undefined; this.execute.disabled = true; this.execute.textContent = t("修改 0 处");
    this.examples.replaceChildren(element("p", "sya-batch-empty", t("选择样式后，这里会显示修改前后的效果")));
    this.status.dataset.state = "pending";
    this.progress.hide();
    if (!this.spec.source || !this.spec.targetId) { this.status.textContent = t("请选择源样式和目标工具"); return; }
    this.status.textContent = t("准备预览…");
    this.timer = setTimeout(() => void this.preview(), 160);
  }
  private async preview(): Promise<void> {
    const sequence = this.sequence; const controller = this.controller = new AbortController();
    this.progress.begin();
    try {
      const plan = await this.prepare(structuredClone(this.spec), controller.signal, (progress) => {
        if (!this.closed && sequence === this.sequence) { this.progress.update(progress); this.status.textContent = t("正在准备预览…"); }
      });
      if (this.closed || controller.signal.aborted || sequence !== this.sequence) return;
      this.plan = plan; this.status.textContent = t("命中 {0} 处，实际将修改 {1} 处（{2} 个块）", plan.matched, plan.changed, plan.blocks.length);
      this.execute.textContent = t("修改 {0} 处", plan.changed); this.execute.disabled = !plan.changed;
      this.status.dataset.state = "ready";
      this.progress.hide(); this.examples.replaceChildren();
      if (plan.examples.length) {
        const labels = element("div", "sya-batch-example-labels");
        labels.append(element("span", "", t("修改前")), element("span", "", ""), element("span", "", t("修改后"))); this.examples.append(labels);
      } else this.examples.append(element("p", "sya-batch-empty", plan.matched ? t("当前选择不会改变标注样式") : t("没有匹配的标注")));
      for (const example of plan.examples) {
        const row = element("div", "sya-batch-example");
        const before = element("span", "sya-card__sample"); renderAnnotationPreview(before, example.before);
        const after = element("span", "sya-card__sample"); renderAnnotationPreview(after, example.before, source => replacedAppearance(source, plan.target, plan.mode));
        row.append(before, element("span", "", "→"), after); this.examples.append(row);
      }
    } catch (error) { if (!this.closed && !controller.signal.aborted && sequence === this.sequence) { this.progress.stop(); this.status.dataset.state = "error"; this.status.textContent = error instanceof Error ? error.message : t("预览失败"); } }
  }
  private async submit(): Promise<void> {
    if (!this.plan || this.committing) return;
    this.committing = true; this.execute.disabled = true; this.controls.inert = true;
    const controller = this.controller = new AbortController();
    this.progress.begin();
    try {
      await this.commit(this.plan, controller.signal, (progress) => {
        if (this.closed) return;
        this.progress.update(progress);
        this.status.textContent = progress.phase === "done" ? t("已完成 {0} 处标注", progress.completed) : t("正在批量修改，请查看下方进度");
        if (progress.phase === "saving") { this.cancel.disabled = true; this.element.querySelector<HTMLButtonElement>(".sya-batch-close")!.disabled = true; }
      });
      this.committing = false; this.close();
    } catch (error) {
      this.committing = false; this.controls.inert = false; this.cancel.disabled = false;
      this.progress.stop();
      this.element.querySelector<HTMLButtonElement>(".sya-batch-close")!.disabled = false;
      if (!this.closed && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : t("修改失败");
        this.status.dataset.state = "error";
        this.status.textContent = message.includes(t("重新预览")) ? message : t("{0}。请重新预览。", message);
        this.plan = undefined;
        this.examples.replaceChildren(button("sya-button sya-batch-retry", t("重新预览"), t("重新预览"), () => this.schedule()));
      }
    }
  }
  close(force = false): void {
    if (this.committing && this.cancel.disabled && !force) return;
    this.closed = true; this.sequence++; clearTimeout(this.timer); this.controller?.abort(); this.progress.destroy();
    for (const picker of this.pickers) picker.destroy(); this.element.remove();
  }
  setTools(tools: AnnotationTool[], environment: ColorEnvironment): void {
    this.tools = tools; this.themeChanged(environment);
  }
  themeChanged(environment: ColorEnvironment): void {
    if (this.closed || this.committing) return;
    this.environment = environment; nativeStyles.applyScope(this.element); this.renderControls(); this.schedule();
  }
}
