import { t, toolLabel } from "./i18n";
import {
  type AnnotationTool,
  type NativeMark,
  STYLE_PROPERTIES,
} from "./model";
import { request } from "./api";
import { paintStrip } from "./appearance";
import {
  button,
  element,
  icon,
  renderToolPreview,
  toolAccentColor,
} from "./ui";

/** Snapshot exactly one most-recent native appearance entry; resolve CSS variables now, not on later preset edits. */
export async function inheritCurrentStyle(): Promise<
  Pick<AnnotationTool, "marks" | "styles" | "color">
> {
  const live = window.siyuan?.storage?.["local-fontstyles"];
  const recent = Array.isArray(live)
    ? live
    : await request<unknown>("/api/storage/getLocalStorageVal", {
        key: "local-fontstyles",
      });
  const entry = Array.isArray(recent) ? recent[0] : undefined;
  if (typeof entry !== "string")
    throw new Error(t("请先在思源文字样式面板中选择一个样式，再继承"));
  const [type, ...values] = entry.split("\u200b");
  const styles: Record<string, string> = {};
  if (type === "style1") {
    if (values[0] && values[0] !== "undefined")
      styles["background-color"] = values[0];
    if (values[1] && values[1] !== "undefined") styles.color = values[1];
  } else if (type === "color") styles.color = values[0];
  else if (type === "backgroundColor") styles["background-color"] = values[0];
  else if (type === "fontSize") styles["font-size"] = values[0];
  else if (type === "style2") {
    styles["-webkit-text-stroke"] = "0.2px var(--b3-theme-on-background)";
    styles["-webkit-text-fill-color"] = "transparent";
  } else if (type === "style4")
    styles["text-shadow"] =
      "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)";
  else
    throw new Error(
      t("当前样式是清除格式或不支持继承的类型，请先在思源面板选择颜色或文字效果"),
    );
  const probe = document.createElement("span");
  probe.textContent = "Aa";
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  for (const [key, value] of Object.entries(styles))
    probe.style.setProperty(key, value);
  document.body.append(probe);
  try {
    const computed = getComputedStyle(probe);
    for (const key of Object.keys(styles))
      styles[key] = computed.getPropertyValue(key).trim();
  } finally {
    probe.remove();
  }
  const color =
    styles["text-decoration-color"] ||
    styles.color ||
    styles["background-color"] ||
    "#8b849b";
  return { marks: [], styles, color };
}

export class ToolManager {
  readonly element = element("dialog", "sya-manager");
  private list = element("div", "sya-manager__list");
  private form = element("form", "sya-manager__form");
  private error = element("div", "sya-manager__error");
  private preview = element(
    "span",
    "sya-manager__sample",
    t("把值得记住的文字留下来 Aa"),
  );
  private tools: AnnotationTool[];
  private draft!: AnnotationTool;
  private inherit = element("input", "");
  private fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private marks = new Map<NativeMark, HTMLInputElement>();
  private generation = 0;
  private closed = false;
  constructor(
    tools: AnnotationTool[],
    private commit: (tools: AnnotationTool[]) => Promise<void>,
    id?: string,
    create = false,
  ) {
    this.tools = structuredClone(tools);
    const heading = element("div", "sya-manager__header");
    heading.append(
      element("strong", "", t("标注工具设置")),
      button("sya-icon-button", t("关闭工具设置"), icon("close"), () =>
        this.close(),
      ),
    );
    const layout = element("div", "sya-manager__layout");
    layout.append(this.list, this.form);
    this.element.append(heading, layout);
    this.element.addEventListener("cancel", () => this.close());
    document.body.append(this.element);
    if (this.element.showModal) this.element.showModal();
    else this.element.setAttribute("open", "");
    if (create || !tools.length) this.newTool();
    else this.edit(this.tools.find((tool) => tool.id === id) ?? this.tools[0]);
  }
  private newTool(): void {
    this.edit({
      id: `tool-${crypto.randomUUID()}`,
      label: t("新标注工具"),
      color: "#c65c68",
      marks: ["u"],
      styles: {},
    });
  }
  private edit(tool: AnnotationTool): void {
    this.generation++;
    this.draft = structuredClone(tool);
    this.fields.clear();
    this.marks.clear();
    this.form.replaceChildren();
    this.renderList();
    const addField = (key: string, label: string, value: string) => {
      const row = element("label", "sya-field");
      row.append(element("span", "", label));
      const input = element("input", "sya-text-input");
      input.value = value;
      input.dataset.field = key;
      input.addEventListener("input", () => this.updatePreview());
      this.fields.set(key, input);
      if (key === "label") row.append(input);
      else {
        const controls = element("div", "sya-color-field");
        const picker = element("input", "sya-color-picker");
        picker.type = "color";
        picker.setAttribute("aria-label", t("选择{0}", label));
        const syncPicker = () => {
          const probe = document.createElement("span");
          probe.style.color = input.value || "#477baf";
          probe.style.visibility = "hidden";
          document.body.append(probe);
          const channels = getComputedStyle(probe).color.match(/[\d.]+/g);
          probe.remove();
          if (channels && channels.length >= 3)
            picker.value = `#${channels
              .slice(0, 3)
              .map((channel) =>
                Math.round(Number(channel)).toString(16).padStart(2, "0"),
              )
              .join("")}`;
        };
        syncPicker();
        input.addEventListener("input", syncPicker);
        picker.addEventListener("input", () => {
          input.value = picker.value;
          this.updatePreview();
        });
        controls.append(input, picker);
        row.append(controls);
      }
      this.form.append(row);
      return input;
    };
    addField("label", t("工具名称"), toolLabel(tool)).maxLength = 60;
    const inheritRow = element("label", "sya-checkbox");
    this.inherit = element("input", "sya-inherit-current");
    this.inherit.type = "checkbox";
    inheritRow.append(
      this.inherit,
      element("span", "", t("继承思源当前使用的一个样式（独立副本）")),
    );
    this.form.append(inheritRow);
    this.inherit.addEventListener("change", async () => {
      const generation = ++this.generation;
      if (!this.inherit.checked) return;
      this.error.textContent = t("正在读取当前样式…");
      try {
        const inherited = await inheritCurrentStyle();
        if (this.closed || generation !== this.generation) return;
        this.edit({
          ...this.draft,
          ...inherited,
          label: this.fields.get("label")!.value === toolLabel(this.draft) ? this.draft.label : this.fields.get("label")!.value,
        });
        this.inherit.checked = true;
        this.error.textContent = t("已复制当前样式，可继续修改组合效果");
      } catch (error) {
        if (this.closed || generation !== this.generation) return;
        this.inherit.checked = false;
        this.error.textContent =
          error instanceof Error ? error.message : t("读取失败");
      }
    });
    addField("color", t("文字颜色"), tool.styles.color ?? "");
    addField(
      "background-color",
      t("背景颜色"),
      tool.styles["background-color"] ?? "",
    );
    const effects = element("div", "sya-effect-grid");
    for (const [mark, label] of [
      ["mark", t("原生高亮")],
      ["strong", t("加粗")],
      ["em", t("斜体")],
      ["u", t("下划线")],
      ["s", t("删除线")],
      ["sup", t("上标")],
      ["sub", t("下标")],
    ] as [NativeMark, string][]) {
      const row = element("label", "sya-checkbox");
      const input = element("input", "");
      input.type = "checkbox";
      input.checked = tool.marks.includes(mark);
      input.dataset.mark = mark;
      this.marks.set(mark, input);
      input.addEventListener("change", () => {
        if (input.checked && mark === "sup")
          this.marks.get("sub")!.checked = false;
        if (input.checked && mark === "sub")
          this.marks.get("sup")!.checked = false;
        this.updatePreview();
      });
      row.append(input, element("span", "", label));
      effects.append(row);
    }
    this.form.append(effects);
    const lineRow = element("label", "sya-field");
    lineRow.append(element("span", "", t("下划线形状")));
    const line = element("select", "sya-text-input");
    for (const [value, label] of [
      ["", t("默认实线")],
      ["wavy", t("波浪线")],
      ["dotted", t("点线")],
      ["dashed", t("虚线")],
      ["double", t("双线")],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      line.append(option);
    }
    line.value = tool.styles["text-decoration-style"] ?? "";
    line.dataset.field = "text-decoration-style";
    this.fields.set("text-decoration-style", line);
    line.addEventListener("change", () => {
      if (line.value) this.marks.get("u")!.checked = true;
      this.updatePreview();
    });
    lineRow.append(line);
    this.form.append(lineRow);
    addField(
      "text-decoration-color",
      t("划线颜色"),
      tool.styles["text-decoration-color"] ?? "",
    );
    for (const [key, label] of [
      ["shadow", t("文字阴影")],
      ["hollow", t("空心文字")],
    ]) {
      const row = element("label", "sya-checkbox");
      const input = element("input", "");
      input.type = "checkbox";
      input.checked =
        !!tool.styles[key === "shadow" ? "text-shadow" : "-webkit-text-stroke"];
      this.fields.set(key, input);
      input.addEventListener("change", () => this.updatePreview());
      row.append(input, element("span", "", label));
      this.form.append(row);
    }
    const sample = element("div", "sya-manager__preview");
    sample.append(this.preview);
    this.error = element("div", "sya-manager__error");
    this.error.setAttribute("role", "status");
    const footer = element("div", "sya-manager__footer");
    const save = element("button", "sya-button sya-save-tool", t("保存工具"));
    save.type = "submit";
    footer.append(save);
    if (this.tools.some((item) => item.id === tool.id))
      footer.append(
        button("sya-button", t("删除当前工具"), t("删除工具"), () => {
          void this.remove(tool.id);
        }),
      );
    this.form.append(sample, this.error, footer);
    this.form.onsubmit = (event) => {
      event.preventDefault();
      void this.save();
    };
    this.updatePreview();
  }
  private readDraft(): AnnotationTool {
    const styles = { ...this.draft.styles };
    for (const key of [
      "color",
      "background-color",
      "text-decoration-style",
      "text-decoration-color",
    ]) {
      const value = this.fields.get(key)?.value.trim();
      if (value) styles[key] = value;
      else delete styles[key];
    }
    if (styles["text-decoration-style"])
      styles["text-decoration-line"] = "underline";
    else delete styles["text-decoration-line"];
    if ((this.fields.get("shadow") as HTMLInputElement)?.checked)
      styles["text-shadow"] ||=
        "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter)";
    else delete styles["text-shadow"];
    if ((this.fields.get("hollow") as HTMLInputElement)?.checked) {
      styles["-webkit-text-stroke"] ||= "0.2px var(--b3-theme-on-background)";
      styles["-webkit-text-fill-color"] = "transparent";
    } else {
      delete styles["-webkit-text-stroke"];
      delete styles["-webkit-text-fill-color"];
    }
    const canonical = document.createElement("span");
    for (const [key, value] of Object.entries(styles))
      canonical.style.setProperty(key, value);
    const marks = [...this.marks]
      .filter(([, input]) => input.checked)
      .map(([mark]) => mark);
    return {
      ...this.draft,
      label: this.fields.get("label")!.value.trim() === toolLabel(this.draft) ? this.draft.label : this.fields.get("label")!.value.trim(),
      color: toolAccentColor({ marks, styles }),
      marks,
      styles: Object.fromEntries(
        Object.keys(styles).map((key) => [
          key,
          canonical.style.getPropertyValue(key) || styles[key],
        ]),
      ),
    };
  }
  private updatePreview(): void {
    const draft = this.readDraft();
    renderToolPreview(this.preview, draft);
    const selected = this.list.querySelector<HTMLElement>(".is-selected .sya-manager__select");
    if (selected) paintStrip(selected, draft);
  }
  private async save(): Promise<void> {
    const tool = this.readDraft();
    if (!tool.label) {
      this.error.textContent = t("请输入工具名称");
      return;
    }
    if (!tool.marks.length && !Object.keys(tool.styles).length) {
      this.error.textContent = t("请至少选择一种颜色或文字效果");
      return;
    }
    for (const [key, value] of Object.entries(tool.styles))
      if (
        !STYLE_PROPERTIES.has(key) ||
        !CSS.supports(key, value) ||
        /url\s*\(|expression\s*\(/i.test(value)
      ) {
        this.error.textContent = t("样式值无效：{0}", key);
        return;
      }
    const next = this.tools.some((item) => item.id === tool.id)
      ? this.tools.map((item) => (item.id === tool.id ? tool : item))
      : [...this.tools, tool];
    try {
      await this.commit(next);
      if (this.closed) return;
      this.tools = next;
      this.edit(tool);
      this.error.textContent = t("已保存；历史标注不会被改写");
    } catch (error) {
      this.error.textContent =
        error instanceof Error ? error.message : t("保存失败，请重试");
    }
  }
  private renderList(): void {
    this.list.replaceChildren();
    this.list.append(
      button("sya-button", t("新建工具"), t("{0} 新建", icon("plus")), () =>
        this.newTool(),
      ),
    );
    for (const [index, tool] of this.tools.entries()) {
      const row = element(
        "div",
        `sya-manager__tool${tool.id === this.draft.id ? " is-selected" : ""}`,
      );
      const select = button("sya-manager__select", toolLabel(tool), "", () =>
        this.edit(tool),
      );
      select.textContent = toolLabel(tool);
      paintStrip(select, tool);
      row.append(
        select,
        button("sya-icon-button", t("上移 {0}", toolLabel(tool)), "↑", () => {
          void this.move(index, -1);
        }),
        button("sya-icon-button", t("下移 {0}", toolLabel(tool)), "↓", () => {
          void this.move(index, 1);
        }),
      );
      this.list.append(row);
    }
  }
  private async move(index: number, direction: number): Promise<void> {
    const target = index + direction;
    if (target < 0 || target >= this.tools.length) return;
    const next = [...this.tools];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await this.commit(next);
      this.tools = next;
      this.renderList();
    } catch {
      this.error.textContent = t("排序保存失败，请重试");
    }
  }
  private async remove(id: string): Promise<void> {
    const next = this.tools.filter((tool) => tool.id !== id);
    try {
      await this.commit(next);
      this.tools = next;
      if (next.length) this.edit(next[0]);
      else this.newTool();
    } catch {
      this.error.textContent = t("删除失败，请重试");
    }
  }
  close(): void {
    this.closed = true;
    this.generation++;
    this.element.remove();
  }
}
