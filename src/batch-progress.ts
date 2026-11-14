import { t } from "./i18n";
import type { ReplacementProgress } from "./replacement";
import { element } from "./ui";

const LABELS = { preparing: "准备预览", validating: "校验原文", saving: "保存标注", verifying: "确认保存", done: "已完成" };
/** Saving is one atomic native transaction: never invent per-item completion. */
export class BatchProgressView {
  readonly element = element("div", "sya-batch-progress");
  private title = element("strong", "sya-batch-phase");
  private count = element("span", "sya-batch-count");
  private bar = element("progress", "sya-batch-progress-bar");
  private detail = element("p", "sya-batch-progress-detail");
  private elapsed = element("span", "sya-batch-elapsed");
  private started = 0;
  private phaseStarted = 0;
  private last?: ReplacementProgress;
  private timer?: ReturnType<typeof setInterval>;
  constructor() {
    const line = element("div", "sya-batch-progress-line"); line.append(this.title, this.count);
    this.bar.setAttribute("aria-label", t("批量修改进度"));
    this.element.setAttribute("role", "status"); this.element.setAttribute("aria-live", "polite");
    this.element.hidden = true;
    this.element.append(line, this.bar, this.detail, this.elapsed);
  }
  begin(): void {
    this.stop(); this.started = this.phaseStarted = Date.now(); this.last = undefined;
    this.element.hidden = false; this.timer = setInterval(() => this.tick(), 1000); this.tick();
  }
  update(progress: ReplacementProgress): void {
    if (progress.phase !== this.last?.phase) this.phaseStarted = Date.now();
    this.last = progress;
    this.element.dataset.phase = progress.phase;
    this.title.textContent = t(LABELS[progress.phase]);
    const complete = Math.min(progress.completed, progress.total);
    const countLabel = progress.phase === "preparing" ? t("已准备") : progress.phase === "validating" ? t("已校验") : t("已完成");
    this.count.textContent = t("{0} {1} / {2} 处", countLabel, complete.toLocaleString(), progress.total.toLocaleString());
    this.bar.max = Math.max(1, progress.total);
    if (progress.phase === "saving" || (!progress.completed && progress.phase !== "done")) this.bar.removeAttribute("value");
    else this.bar.value = complete;
    this.detail.textContent = progress.message || (progress.phase === "saving"
      ? t("请求已发送，思源内核正在处理。整批保存后才会确认完成数量，请保持窗口打开。")
      : progress.phase === "verifying" ? t("思源已处理事务，正在核对实际保存结果。")
      : progress.phase === "done" ? t("全部标注已确认保存，可在正文中一次撤销。")
      : t("正在运行，可取消；此阶段尚未写入原文。"));
    this.tick();
    if (progress.phase === "done") this.stop();
  }
  private tick(): void {
    if (!this.started) return;
    const seconds = Math.floor((Date.now() - this.started) / 1000);
    const phaseSeconds = Math.floor((Date.now() - this.phaseStarted) / 1000);
    this.elapsed.textContent = t("已用时 {0}{1} 秒{2}", seconds >= 60 ? t("{0} 分 ", Math.floor(seconds / 60)) : "", seconds % 60, this.last?.phase === "saving" ? t(" · 思源处理中 {0} 秒", phaseSeconds) : "");
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }
  hide(): void { this.stop(); this.element.hidden = true; }
  destroy(): void { this.stop(); this.element.remove(); }
}
