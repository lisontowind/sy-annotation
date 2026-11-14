import { t, toolLabel } from "./i18n";
import type { Annotation, AnnotationTool } from "./model";
import { appearanceOf, visualSignature, type ColorEnvironment } from "./appearance";
import type { AnnotationQuery } from "./filters";
import type { ReplacementMode, ReplacementPlan, ProgressReporter } from "./replacement";
import { BatchProgressView } from "./batch-progress";
import { selectOptions, styleChoices } from "./filter-dialog";
import { button, element, icon, renderToolPreview } from "./ui";

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
  private spec: BatchSpec;
  constructor(private annotations: Annotation[], private tools: AnnotationTool[], private environment: ColorEnvironment, query: AnnotationQuery,
    mode: ReplacementMode, annotation: Annotation | undefined,
    private prepare: (spec: BatchSpec, signal: AbortSignal, progress: ProgressReporter) => Promise<ReplacementPlan>,
    private commit: (plan: ReplacementPlan, signal: AbortSignal, progress: ProgressReporter) => Promise<void>,
    private modeChanged: (mode: ReplacementMode) => void) {
    this.spec = { sourceKind: annotation ? "signature" : "tool", source: annotation ? visualSignature(appearanceOf(annotation), environment) : tools[0]?.id || "", targetId: tools[0]?.id || "", scope: "document", query: structuredClone(query), mode };
    const header = element("div", "sya-manager__header");
    header.append(element("strong", "", t("批量改样式")), button("sya-icon-button sya-batch-close", t("关闭批量修改"), icon("close"), () => this.close()));
    const body = element("div", "sya-dialog-body"); body.append(element("p", "sya-dialog-intro", t("仅修改当前文档。全文包含未加载的标注；筛选结果不受标题折叠影响。")), this.controls, this.status, this.progress.element, this.examples);
    const footer = element("div", "sya-dialog-footer");
    this.cancel = button("sya-button", t("取消批量修改"), t("取消"), () => this.close());
    this.execute = button("sya-button sya-primary sya-batch-execute", t("执行批量修改"), t("修改 0 处"), () => void this.submit());
    footer.append(this.cancel, this.execute); this.element.append(header, body, footer);
    this.element.addEventListener("cancel", (event) => { event.preventDefault(); this.close(); });
    document.body.append(this.element); this.element.showModal(); this.renderControls(); this.schedule();
  }
  private renderControls(): void {
    this.controls.replaceChildren();
    const add = (label: string, select: HTMLElement) => { const row = element("label", "sya-field"); row.append(element("span", "", label), select); this.controls.append(row); };
    add(t("源样式匹配"), selectOptions([["tool", t("按工具特征")], ["signature", t("按完整样式")]], this.spec.sourceKind, (value) => {
      this.spec.sourceKind = value as BatchSpec["sourceKind"]; this.spec.source = ""; this.renderControls(); this.schedule();
    }, "sya-text-input sya-batch-source-kind"));
    const choices = this.spec.sourceKind === "tool" ? this.tools.map((tool): [string, string] => [tool.id, toolLabel(tool)]) : styleChoices(this.annotations, this.environment);
    add(t("源样式"), selectOptions([["", t("请选择源样式…")], ...choices], this.spec.source, (value) => { this.spec.source = value; this.schedule(); }, "sya-text-input sya-batch-source"));
    add(t("目标工具"), selectOptions([["", t("请选择目标工具…")], ...this.tools.map((tool): [string, string] => [tool.id, toolLabel(tool)])], this.spec.targetId, (value) => { this.spec.targetId = value; this.schedule(); }, "sya-text-input sya-batch-target"));
    add(t("替换模式"), selectOptions([["replace", t("完全采用目标样式")], ["preserve", t("保留额外格式")]], this.spec.mode, (value) => { this.spec.mode = value as ReplacementMode; this.modeChanged(this.spec.mode); this.schedule(); }, "sya-text-input sya-batch-mode"));
    add(t("修改范围"), selectOptions([["document", t("当前文档全文")], ["filtered", t("当前筛选结果")]], this.spec.scope, (value) => { this.spec.scope = value as BatchSpec["scope"]; this.schedule(); }, "sya-text-input sya-batch-scope"));
    this.controls.append(element("p", "sya-mode-help", t("保留额外格式：替换颜色、划线、删除线、阴影和空心；保留加粗、斜体、上下标及字体字号，目标工具设置优先。")));
  }
  private schedule(): void {
    clearTimeout(this.timer); this.controller?.abort(); this.sequence++; this.plan = undefined; this.execute.disabled = true; this.execute.textContent = t("修改 0 处"); this.examples.replaceChildren();
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
      this.progress.stop();
      for (const example of plan.examples) {
        const row = element("div", "sya-batch-example");
        const before = element("span", "sya-card__sample", example.before.text); renderToolPreview(before, { id: "", label: "", color: "", ...appearanceOf(example.before) });
        const after = element("span", "sya-card__sample", example.before.text); renderToolPreview(after, { id: "", label: "", color: "", ...example.after });
        row.append(before, element("span", "", "→"), after); this.examples.append(row);
      }
    } catch (error) { if (!this.closed && !controller.signal.aborted && sequence === this.sequence) { this.progress.stop(); this.status.textContent = error instanceof Error ? error.message : t("预览失败"); } }
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
        this.status.textContent = message.includes(t("重新预览")) ? message : t("{0}。请重新预览。", message);
        this.plan = undefined;
        this.examples.replaceChildren(button("sya-button sya-batch-retry", t("重新预览"), t("重新预览"), () => this.schedule()));
      }
    }
  }
  close(force = false): void {
    if (this.committing && this.cancel.disabled && !force) return;
    this.closed = true; this.sequence++; clearTimeout(this.timer); this.controller?.abort(); this.progress.destroy(); this.element.remove();
  }
}
