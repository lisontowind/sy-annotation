import { t, toolLabel } from "./i18n";
import {
  type AnnotationTool,
  type NativeMark,
  STYLE_PROPERTIES,
} from "./model";
import { paintStrip } from "./appearance";
import { ColorField } from "./color-field";
import { browserColor } from "./theme-colors";
import { nativeDefaultGroup, nativeStyles } from "./native-styles";
import { StylePicker } from "./style-picker";
import {
  button,
  element,
  icon,
  renderToolPreview,
  toolAccentColor,
} from "./ui";

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
  private fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private colors = new Map<string, ColorField>();
  private marks = new Map<NativeMark, HTMLInputElement>();
  private closed = false;
  private unsubscribe: () => void;
  private nativePicker?: StylePicker;
  constructor(
    tools: AnnotationTool[],
    private commit: (tools: AnnotationTool[]) => Promise<void>,
    id?: string,
    create = false,
    repair?: () => void,
    initialStyle?: Pick<AnnotationTool, "marks" | "styles">,
  ) {
    this.tools = structuredClone(tools);
    const heading = element("div", "sya-manager__header");
    const actions = element("div", "sya-manager__actions");
    actions.append(
      button("sya-icon-button", t("关闭工具设置"), icon("close"), () =>
        this.close(),
      ),
    );
    heading.append(element("strong", "", t("标注工具设置")), actions);
    const layout = element("div", "sya-manager__layout");
    layout.append(this.list, this.form);
    this.element.append(heading, layout);
    if (repair) {
      const advanced = element("details", "sya-manager__advanced");
      advanced.append(element("summary", "", t("旧样式迁移")), button("sya-button sya-repair-colors", t("修复旧颜色"), t("修复旧颜色"), repair));
      this.element.append(advanced);
    }
    this.unsubscribe = nativeStyles.subscribe(() => {
      nativeStyles.applyScope(this.element);
      this.nativePicker?.update(nativeStyles.tools, ""); this.updatePreview();
    });
    nativeStyles.applyScope(this.element);
    this.element.addEventListener("cancel", () => this.close());
    document.body.append(this.element);
    if (this.element.showModal) this.element.showModal();
    else this.element.setAttribute("open", "");
    if (create || !tools.length) this.newTool(initialStyle);
    else this.edit(this.tools.find((tool) => tool.id === id) ?? this.tools[0]);
  }
  private newTool(style?: Pick<AnnotationTool, "marks" | "styles">): void {
    this.edit({
      id: `tool-${crypto.randomUUID()}`,
      label: style ? t("新组合样式") : t("新标注工具"),
      color: style ? toolAccentColor(style) : "#c65c68",
      marks: style?.marks ?? ["u"],
      styles: style?.styles ?? {},
    });
  }
  private edit(tool: AnnotationTool): void {
    this.draft = structuredClone(tool);
    this.fields.clear();
    for (const color of this.colors.values()) color.destroy();
    this.colors.clear();
    this.marks.clear();
    this.form.replaceChildren();
    this.nativePicker?.destroy();
    this.renderList();
    const addField = (key: string, label: string, value: string) => {
      const row = element("label", "sya-field");
      row.append(element("span", "", label));
      const input = element("input", "sya-text-input");
      input.value = value;
      input.dataset.field = key;
      input.addEventListener("input", () => this.updatePreview());
      this.fields.set(key, input);
      row.append(input);
      this.form.append(row);
      return input;
    };
    const addColor = (key: string, label: string, value: string) => {
      const color = new ColorField(key, value, () => this.updatePreview(), label);
      this.colors.set(key, color); this.form.append(color.element);
    };
    addField("label", t("工具名称"), toolLabel(tool)).maxLength = 60;
    this.nativePicker = new StylePicker(id => {
      const native = nativeStyles.tools.find(item => item.id === id);
      if (!native) return;
      const draft = this.readDraft();
      const styles = { ...draft.styles, ...native.styles };
      const reset = nativeDefaultGroup(native.nativeRef);
      if (reset && reset !== "backgroundColor") delete styles.color;
      if (reset && reset !== "color") delete styles["background-color"];
      this.edit({ ...draft, styles });
    }, { label: t("选择思源样式") });
    this.nativePicker.update(nativeStyles.tools, "");
    this.form.append(this.nativePicker.element);
    addColor("color", t("文字颜色"), tool.styles.color ?? "");
    addColor(
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
    addColor(
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
    const marks = [...this.marks]
      .filter(([, input]) => input.checked)
      .map(([mark]) => mark);
    for (const key of [
      "color",
      "background-color",
      "text-decoration-style",
      "text-decoration-color",
    ]) {
      const value = this.colors.has(key) ? this.colors.get(key)!.value : this.fields.get(key)?.value.trim();
      if (value) styles[key] = value;
      else delete styles[key];
    }
    if (styles["text-decoration-style"] && (marks.includes("u") || marks.includes("s")))
      styles["text-decoration-line"] = [
        ...(marks.includes("u") ? ["underline"] : []),
        ...(marks.includes("s") ? ["line-through"] : []),
      ].join(" ");
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
      canonical.style.setProperty(key, browserColor(value));
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
    if ([...this.colors.values()].some(field => !field.valid())) {
      this.error.textContent = t("请选择可用的思源颜色"); return;
    }
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
  themeChanged(): void {
    nativeStyles.applyScope(this.element); this.nativePicker?.update(nativeStyles.tools, "");
    for (const color of this.colors.values()) color.themeChanged();
    this.updatePreview();
  }
  close(): void {
    this.closed = true;
    this.unsubscribe();
    this.nativePicker?.destroy();
    for (const color of this.colors.values()) color.destroy();
    this.element.remove();
  }
}
