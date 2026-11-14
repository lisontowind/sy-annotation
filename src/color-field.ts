import { t } from "./i18n";
import { nativeColorKey, nativeDefaultGroup, nativeRef, nativeStyles } from "./native-styles";
import { StylePicker } from "./style-picker";
import { element } from "./ui";

/** Native choices plus a lossless, read-only existing value for older tools. */
export class ColorField {
  readonly element = element("div", "sya-color-editor");
  private picker: StylePicker;
  private selected = "";
  private unsubscribe: () => void;
  constructor(readonly property: string, private original: string, private changed: () => void, label: string, private allowUnset = true) {
    this.element.dataset.colorProperty = property;
    this.picker = new StylePicker(id => { this.selected = id; this.render(); this.changed(); }, {
      label, groups: [property === "background-color" ? "backgroundColor" : "color"], recent: false,
      prefix: original ? [["existing", t("保留现有颜色")]] : [],
    });
    this.element.append(element("div", "sya-picker-heading", label), this.picker.element);
    this.selected = original ? "existing" : allowUnset ? `native:${property === "background-color" ? "backgroundColor" : "color"}:default` : "";
    this.unsubscribe = nativeStyles.subscribe(() => this.render()); this.render();
  }
  private get cssProperty(): "color" | "background-color" { return this.property === "background-color" ? "background-color" : "color"; }
  private get tools() { return nativeStyles.tools.filter(tool => tool.nativeRef?.group === (this.property === "background-color" ? "backgroundColor" : "color") && (this.allowUnset || !nativeDefaultGroup(tool.nativeRef))); }
  get value(): string {
    if (nativeDefaultGroup(nativeRef(this.selected))) return "";
    if (this.selected === "existing") return this.allowUnset || nativeColorKey(this.original, this.cssProperty) ? this.original : "";
    return this.tools.find(tool => tool.id === this.selected)?.styles[this.cssProperty] || "";
  }
  valid(): boolean { return (!!nativeDefaultGroup(nativeRef(this.selected)) && this.allowUnset) || !!this.value; }
  private render(): void {
    const tools = this.tools, key = nativeColorKey(this.value, this.cssProperty);
    const match = key ? tools.find(tool => nativeColorKey(tool.styles[this.cssProperty], this.cssProperty) === key) : undefined;
    this.picker.update(tools, this.selected, this.selected === "existing" ? (match ? match.label : t("保留现有颜色")) : undefined);
    const preview = this.element.querySelector<HTMLElement>(".sya-picker-current");
    if (preview && this.value) preview.style.setProperty(this.property, this.value);
  }
  destroy(): void { this.unsubscribe(); this.picker.destroy(); }
  themeChanged(): void { this.render(); }
}
