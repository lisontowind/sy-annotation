import { t } from "./i18n";
import { ColorField } from "./color-field";
import { resolveValue, readColorEnvironment } from "./appearance";
import { colorPair } from "./theme-colors";
import { nativeStyles } from "./native-styles";
import type { ColorCandidate, ColorMapping } from "./color-repair";
import type { AnnotationTool } from "./model";
import type { BlockEditPlan, ProgressReporter } from "./replacement";
import { button, element, icon, renderToolPreview } from "./ui";
import { selectOptions } from "./filter-dialog";
import { BatchProgressView } from "./batch-progress";

export type RepairScope = "tools" | "document";
export interface ColorRepairPlan extends BlockEditPlan { scope: RepairScope; tools?: AnnotationTool[]; }
export class ColorRepairDialog {
  readonly element = element("dialog", "sya-manager sya-color-repair-dialog");
  private rows = element("div", "sya-repair-rows");
  private examples = element("div", "sya-batch-examples");
  private status = element("div", "sya-dialog-status");
  private controls = element("div", "sya-repair-controls");
  private scope: RepairScope = "tools";
  private fields: { candidate: ColorCandidate; field: ColorField; enabled: HTMLInputElement }[] = [];
  private execute: HTMLButtonElement;
  private restore: HTMLButtonElement;
  private controller?: AbortController;
  private plan?: ColorRepairPlan;
  private sequence = 0;
  private closed = false;
  private committing = false;
  private preparing = false;
  private progress = new BatchProgressView();
  constructor(private candidates: (scope: RepairScope) => ColorCandidate[],
    private prepare: (scope: RepairScope, mappings: ColorMapping[], signal: AbortSignal) => Promise<ColorRepairPlan>,
    private commit: (plan: ColorRepairPlan, signal: AbortSignal, progress: ProgressReporter) => Promise<void>,
    restore: () => Promise<void>, canRestore: boolean) {
    this.restoreAvailable = canRestore;
    const header = element("div", "sya-manager__header");
    header.append(element("strong", "", t("修复旧颜色")), button("sya-icon-button", t("关闭颜色修复"), icon("close"), () => this.close()));
    const scope = selectOptions([["tools", t("旧工具")], ["document", t("当前文档")]], "tools", value => {
      this.scope = value as RepairScope; this.renderCandidates();
    }, "sya-text-input sya-repair-scope");
    this.controls.append(scope, button("sya-button sya-repair-refresh", t("刷新颜色列表"), t("刷新颜色列表"), () => this.renderCandidates()), this.rows);
    const body = element("div", "sya-dialog-body");
    body.append(element("p", "sya-dialog-intro", t("勾选旧颜色，选择要关联的思源原生颜色，再预览确认。正文修复包含未加载的标注，可一次撤销。")), this.controls, this.status, this.progress.element, this.examples);
    this.execute = button("sya-button sya-primary sya-repair-execute", t("确认修复"), t("确认修复"), () => void this.submit());
    this.restore = button("sya-button sya-repair-restore", t("恢复工具备份"), t("恢复工具备份"), () => {
      this.invalidate(); this.busy(true);
      void restore().then(() => { if (!this.closed) { this.renderCandidates(); this.status.textContent = t("已恢复工具备份"); } })
        .catch(error => { if (!this.closed) this.status.textContent = String(error); }).finally(() => this.busy(false));
    });
    this.restore.disabled = !canRestore;
    const footer = element("div", "sya-dialog-footer");
    footer.append(this.restore, button("sya-button sya-repair-preview", t("预览修复"), t("预览修复"), () => void this.preview()), this.execute);
    this.element.append(header, body, footer);
    this.element.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    document.body.append(this.element); this.element.showModal(); this.renderCandidates();
  }
  private renderCandidates(): void {
    for (const row of this.fields) row.field.destroy();
    this.invalidate(); this.rows.replaceChildren(); this.fields = [];
    const labels: Record<string, string> = { color: t("文字颜色"), "background-color": t("背景颜色"), "text-decoration-color": t("划线颜色") };
    const env = readColorEnvironment();
    for (const candidate of this.candidates(this.scope)) {
      const row = element("div", "sya-repair-row");
      const enabled = element("input", "sya-repair-enabled"); enabled.type = "checkbox";
      const label = element("label", "sya-checkbox");
      label.append(enabled, element("span", "", t("{0}：{1} · {2} 处", labels[candidate.property], candidate.value, candidate.count)));
      const property = candidate.property === "background-color" ? "background-color" : "color";
      const suggestions = nativeStyles.tools.filter(tool => !tool.hidden && tool.nativeRef?.group === (property === "color" ? "color" : "backgroundColor"))
        .map(tool => tool.styles[property]).filter(value => value && resolveValue(value, env) === candidate.value);
      const field = new ColorField(candidate.property, suggestions.length === 1 ? suggestions[0] : candidate.value, () => this.invalidate(), labels[candidate.property], false);
      enabled.addEventListener("change", () => this.invalidate());
      row.append(label);
      if (suggestions.length === 1) row.append(element("p", "sya-mode-help", t("建议使用与当前颜色完全一致的思源预设；勾选后才会转换。")));
      row.append(field.element); this.rows.append(row); this.fields.push({ candidate, field, enabled });
    }
    if (!this.fields.length) this.rows.append(element("p", "sya-mode-help", t("没有可修复的固定色；当前文档需先打开并等待索引完成。")));
  }
  invalidate(): void {
    if (this.closed || this.committing) return;
    this.sequence++; this.controller?.abort(); this.plan = undefined;
    this.preparing = false;
    this.execute.disabled = true; this.examples.replaceChildren(); this.progress.hide();
    this.status.textContent = t("请预览确认；内容、工具、主题或映射变化后需重新预览。");
  }
  private async preview(): Promise<void> {
    if (this.committing) return;
    this.invalidate();
    const selected = this.fields.filter(row => row.enabled.checked);
    if (!selected.length) { this.status.textContent = t("请先勾选要修复的颜色"); return; }
    if (selected.some(row => !row.field.valid() || !row.field.value)) { this.status.textContent = t("请选择可用的思源颜色"); return; }
    const sequence = this.sequence, controller = this.controller = new AbortController();
    this.preparing = true;
    this.status.textContent = t("正在准备预览…");
    try {
      const plan = await this.prepare(this.scope, selected.map(({ candidate, field }) => ({ property: candidate.property, from: candidate.value, to: field.value })), controller.signal);
      if (this.closed || controller.signal.aborted || sequence !== this.sequence) return;
      this.plan = plan; this.execute.disabled = !plan.changed;
      this.status.textContent = plan.scope === "tools" ? t("将修改 {0} 个工具", plan.changed) : t("命中 {0} 处，实际将修改 {1} 处（{2} 个块）", plan.matched, plan.changed, plan.blocks.length);
      for (const example of plan.examples) {
        const row = element("div", "sya-batch-example");
        const before = element("span", "sya-card__sample", example.before.text);
        const after = element("span", "sya-card__sample", example.before.text);
        const [marks, entries] = JSON.parse(example.before.signature);
        renderToolPreview(before, { id: "", label: "", color: "", marks, styles: Object.fromEntries(entries) });
        renderToolPreview(after, { id: "", label: "", color: "", ...example.after });
        row.append(before, element("span", "", "→"), after);
        // Literal pairs can preview both branches; native presets use the current host palette.
        for (const theme of Object.values(example.after.styles).some(value => colorPair(value)) ? ["light", "dark"] : []) {
          const pair = row.cloneNode(true) as HTMLElement; pair.classList.add("sya-repair-example");
          pair.style.colorScheme = theme; pair.dataset.themePreview = theme;
          pair.prepend(element("span", "", theme === "light" ? t("浅色") : t("深色"))); this.examples.append(pair);
        }
        if (!Object.values(example.after.styles).some(value => colorPair(value))) this.examples.append(row);
      }
    } catch (error) { if (!this.closed && !controller.signal.aborted && sequence === this.sequence) this.status.textContent = String(error); }
    finally { if (sequence === this.sequence) this.preparing = false; }
  }
  stateChanged(): void {
    nativeStyles.applyScope(this.element);
    for (const row of this.fields) row.field.themeChanged();
    if (this.plan || this.preparing) this.invalidate();
  }
  private busy(value: boolean): void {
    this.committing = value; this.controls.inert = value;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value;
    this.execute.disabled = true;
    if (!value) this.restore.disabled = !this.restoreAvailable;
  }
  private restoreAvailable = false;
  private async submit(): Promise<void> {
    if (!this.plan || this.committing) return;
    const plan = this.plan, controller = this.controller = new AbortController(); this.busy(true); this.progress.begin();
    try {
      await this.commit(plan, controller.signal, progress => {
        this.progress.update(progress);
      });
      if (plan.scope === "tools") this.restoreAvailable = true;
      this.busy(false); this.renderCandidates(); this.progress.stop(); this.status.textContent = t("颜色修复已完成");
    } catch (error) { this.busy(false); this.invalidate(); this.status.textContent = String(error); }
  }
  close(force = false): void {
    if (this.committing && !force) return;
    this.closed = true; this.controller?.abort(); this.sequence++; this.progress.destroy();
    for (const row of this.fields) row.field.destroy();
    this.element.remove();
  }
}
