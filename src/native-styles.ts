import type { AnnotationTool } from "./model";
import { t } from "./i18n";
import { request } from "./api";

export type NativeStyleGroup = "style1" | "color" | "backgroundColor" | "effect";
export interface NativeStyleRef { group: NativeStyleGroup; key: string; }
export type NativeColorGroup = Exclude<NativeStyleGroup, "effect">;
export const nativeDefaultGroup = (ref?: NativeStyleRef): NativeColorGroup | undefined =>
  ref?.key === "default" && ref.group !== "effect" ? ref.group : undefined;
export interface NativeThemeColors { color?: string; backgroundColor?: string; }
export interface NativeStyleData {
  version: number;
  styles: { id: string; name: string; hidden?: boolean; light: NativeThemeColors; dark: NativeThemeColors }[];
  builtin: {
    colors: { index: number; light: NativeThemeColors; dark: NativeThemeColors }[];
    styles: { id: string; light: NativeThemeColors; dark: NativeThemeColors }[];
    hidden: { color: number[]; backgroundColor: number[]; style1: string[] };
  };
  order: { color: string[]; backgroundColor: string[]; style1: string[] };
}
const STYLE_IDS = ["error", "warning", "info", "success"];
const INDEXES = Array.from({ length: 13 }, (_, i) => String(i + 1));
const CUSTOM_ID = /^\d{14}-[a-z0-9]{7}$/;
export const nativeToolId = (ref: NativeStyleRef): string => CUSTOM_ID.test(ref.key) ? `native:custom:${ref.key}` : `native:${ref.group}:${ref.key}`;
export function nativeRef(id: string): NativeStyleRef | undefined {
  const custom = /^native:custom:(\d{14}-[a-z0-9]{7})$/.exec(id);
  if (custom) return { group: "style1", key: custom[1] };
  const match = /^native:(style1|color|backgroundColor|effect):(.+)$/.exec(id);
  if (!match) return;
  const [, group, key] = match;
  if ((group !== "effect" && (key === "default" || CUSTOM_ID.test(key))) || (group === "style1" ? STYLE_IDS.includes(key) : group === "effect" ? ["hollow", "shadow"].includes(key) : INDEXES.includes(key)))
    return { group: group as NativeStyleGroup, key };
}
export const isNativeToolId = (id: string): boolean => !!nativeRef(id);
const colors = (value: any): NativeThemeColors => Object.fromEntries(
  ["color", "backgroundColor"].filter(key => typeof value?.[key] === "string" && /^#[\da-f]{6}$/i.test(value[key])).map(key => [key, value[key].toLowerCase()]),
);
export function nativeGroup(style: { light: NativeThemeColors; dark: NativeThemeColors }): Exclude<NativeStyleGroup, "effect"> | undefined {
  const foreground = !!style.light.color && !!style.dark.color;
  const background = !!style.light.backgroundColor && !!style.dark.backgroundColor;
  return foreground && background ? "style1" : foreground ? "color" : background ? "backgroundColor" : undefined;
}
export function normalizeNativeStyles(value: any): NativeStyleData {
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.styles)) throw new Error(t("原生样式数据暂不可用"));
  const seen = new Set<string>();
  const styles: NativeStyleData["styles"] = [];
  for (const item of value.styles) {
    if (!item || !CUSTOM_ID.test(item.id) || seen.has(item.id) || typeof item.name !== "string") continue;
    const style = { id: item.id, name: Array.from(item.name).slice(0, 64).join(""), hidden: !!item.hidden, light: colors(item.light), dark: colors(item.dark) };
    if (!nativeGroup(style)) continue;
    seen.add(item.id); styles.push(style);
  }
  const builtin = {
    colors: (Array.isArray(value.builtin?.colors) ? value.builtin.colors : []).filter((item: any) => item && INDEXES.includes(String(item.index)))
      .map((item: any) => ({ index: Number(item.index), light: colors(item.light), dark: colors(item.dark) })),
    styles: (Array.isArray(value.builtin?.styles) ? value.builtin.styles : []).filter((item: any) => item && STYLE_IDS.includes(item.id))
      .map((item: any) => ({ id: item.id, light: colors(item.light), dark: colors(item.dark) })),
    hidden: {
      color: INDEXES.filter(key => value.builtin?.hidden?.color?.includes(Number(key))).map(Number),
      backgroundColor: INDEXES.filter(key => value.builtin?.hidden?.backgroundColor?.includes(Number(key))).map(Number),
      style1: STYLE_IDS.filter(key => value.builtin?.hidden?.style1?.includes(key)),
    },
  };
  const order = {} as NativeStyleData["order"];
  for (const group of ["style1", "color", "backgroundColor"] as const) {
    const available = [...(group === "style1" ? STYLE_IDS : INDEXES), ...styles.filter(style => nativeGroup(style) === group).map(style => style.id)];
    const authored = Array.isArray(value.order?.[group]) ? value.order[group] : [];
    order[group] = [...new Set<string>([...authored.filter((key: unknown) => typeof key === "string" && available.includes(key)), ...available])];
  }
  return { version: 2, styles, builtin, order };
}
export const emptyNativeStyles = (): NativeStyleData => normalizeNativeStyles({ version: 2, styles: [] });
export const nativeMode = (): "light" | "dark" => typeof document !== "undefined" &&
  (document.documentElement.dataset.themeMode || document.documentElement.dataset.theme ||
    (typeof window !== "undefined" && window.siyuan?.config?.appearance?.mode === 1 ? "dark" : "light")) === "dark" ? "dark" : "light";
export function buildNativeTools(data: NativeStyleData, mode: "light" | "dark" = "light"): AnnotationTool[] {
  const result: AnnotationTool[] = [];
  const labels: Record<string, string> = { error: t("错误样式"), warning: t("警告样式"), info: t("信息样式"), success: t("成功样式") };
  for (const group of ["style1", "color", "backgroundColor"] as const) for (const key of ["default", ...data.order[group]]) {
    const custom = data.styles.find(style => style.id === key);
    const styles: Record<string, string> = {};
    if (custom) {
      for (const property of ["color", "backgroundColor"] as const) if (custom[mode][property]) {
        const css = property === "color" ? "color" : "background-color";
        styles[css] = `var(--b3-inline-style-${key}-${css}, ${custom[mode][property]})`;
      }
    } else if (key === "default") {
      // Native defaults remove authored colors; they do not write theme colors into the document.
    } else if (group === "style1") {
      styles.color = `var(--b3-card-${key}-color)`;
      styles["background-color"] = `var(--b3-card-${key}-background)`;
    } else styles[group === "color" ? "color" : "background-color"] = `var(--b3-font-${group === "color" ? "color" : "background"}${key})`;
    const hidden = custom ? custom.hidden : group === "style1" ? data.builtin.hidden.style1.includes(key) : data.builtin.hidden[group].includes(Number(key));
    const label = key === "default" ? t(group === "style1" ? "默认样式" : group === "color" ? "默认文字颜色" : "默认背景颜色") : custom?.name || (group === "style1" ? labels[key] : t(group === "color" ? "文字颜色 {0}" : "背景颜色 {0}", key));
    result.push({ id: nativeToolId({ group, key }), label, marks: [], styles, color: styles.color || styles["background-color"] || "", nativeRef: { group, key }, hidden });
  }
  for (const key of ["hollow", "shadow"]) result.push({
    id: nativeToolId({ group: "effect", key }), label: key === "hollow" ? t("空心文字") : t("文字阴影"), marks: [],
    color: "var(--b3-theme-on-background)", nativeRef: { group: "effect", key },
    styles: key === "hollow" ? { "-webkit-text-stroke": "0.2px var(--b3-theme-on-background)", "-webkit-text-fill-color": "transparent" } :
      { "text-shadow": "1px 1px var(--b3-theme-surface-lighter), 2px 2px var(--b3-theme-surface-lighter), 3px 3px var(--b3-theme-surface-lighter), 4px 4px var(--b3-theme-surface-lighter)" },
  });
  return result;
}

/** Compare authored variable identities, never coincidentally equal computed colors. */
export function nativeColorKey(value: string | undefined, property: "color" | "background-color"): string | undefined {
  if (!value) return;
  const match = /^var\(\s*(--[\w-]+)\s*(?:,|\))/.exec(value.trim());
  if (!match) return;
  const name = match[1];
  const custom = /^--b3-inline-style-(\d{14}-[a-z0-9]{7})-(color|background-color)$/.exec(name);
  if (custom?.[2] === property) return custom[1];
  const builtin = new RegExp(`^--b3-font-${property === "color" ? "color" : "background"}(\\d+)$`).exec(name);
  if (builtin && INDEXES.includes(builtin[1])) return builtin[1];
  const card = /^--b3-(?:card-|inline-builtin-)(error|warning|info|success)-(color|background|background-color)$/.exec(name);
  if (card && (card[2] === "color" ? property === "color" : property === "background-color")) return card[1];
}
export function matchesNativeStyle(styles: Record<string, string>, ref: NativeStyleRef): boolean {
  const defaultGroup = nativeDefaultGroup(ref);
  if (defaultGroup) return (defaultGroup === "backgroundColor" || !styles.color) && (defaultGroup === "color" || !styles["background-color"]);
  if (CUSTOM_ID.test(ref.key)) return nativeColorKey(styles.color, "color") === ref.key || nativeColorKey(styles["background-color"], "background-color") === ref.key;
  if (ref.group === "effect") return !!styles[ref.key === "hollow" ? "-webkit-text-stroke" : "text-shadow"];
  return (ref.group === "backgroundColor" || nativeColorKey(styles.color, "color") === ref.key) &&
    (ref.group === "color" || nativeColorKey(styles["background-color"], "background-color") === ref.key);
}

export class NativeStyleLibrary {
  manageColors?: (group: NativeColorGroup) => void;
  data = emptyNativeStyles();
  revision = 0;
  status: "loading" | "ready" | "fallback" | "error" = "loading";
  error = "";
  private listeners = new Set<() => void>();
  private observer?: MutationObserver;
  private controller?: AbortController;
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  get tools(): AnnotationTool[] { return buildNativeTools(this.data, nativeMode()); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { for (const listener of this.listeners) listener(); }
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    this.controller?.abort(); const controller = this.controller = new AbortController();
    try {
      const data = normalizeNativeStyles(await request("/api/storage/getInlineStyles", {}, controller.signal));
      if (sequence !== this.sequence) return;
      const changed = JSON.stringify(data) !== JSON.stringify(this.data);
      const statusChanged = this.status !== "ready";
      this.data = data; this.status = "ready"; this.error = "";
      if (changed) this.revision++;
      if (changed || statusChanged) this.notify();
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.status = this.error.includes("404") ? "fallback" : "error";
      this.notify();
    }
  }
  scheduleRefresh(): void {
    if (!this.running) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), 60);
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.observer = new MutationObserver(records => {
      if (records.some(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest("#siyuanStyle") ||
        [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && node.id === "siyuanStyle"))) this.scheduleRefresh();
    });
    this.observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    void this.refresh();
  }
  stop(): void {
    this.running = false; this.sequence++; this.controller?.abort(); this.observer?.disconnect(); clearTimeout(this.timer);
  }
  scopedColors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const item of this.data.builtin.styles) for (const property of ["color", "backgroundColor"] as const) {
      const value = item[nativeMode()][property];
      if (value) result[`--b3-card-${item.id}-${property === "color" ? "color" : "background"}`] = value;
    }
    return result;
  }
  /** SiYuan scopes built-in style overrides to editor content; mirror only in plugin UI. */
  applyScope(node: HTMLElement): void {
    for (const id of STYLE_IDS) for (const property of ["color", "background"]) node.style.removeProperty(`--b3-card-${id}-${property}`);
    for (const [property, value] of Object.entries(this.scopedColors())) node.style.setProperty(property, value);
  }
  recent(tools: AnnotationTool[]): AnnotationTool[] {
    const recent = typeof window !== "undefined" ? window.siyuan?.storage?.["local-fontstyles"] : [];
    const result: AnnotationTool[] = [];
    for (const entry of Array.isArray(recent) ? recent : []) {
      if (typeof entry !== "string") continue;
      const [type, first, second] = entry.split("\u200b");
      const styles: Record<string, string> = type === "style1" ? { "background-color": first || "", color: second || "" } : type === "color" ? { color: first || "" } : { "background-color": first || "" };
      const found = tools.find(tool => tool.nativeRef && !tool.hidden && (type === "style2" ? tool.nativeRef.key === "hollow" : type === "style4" ? tool.nativeRef.key === "shadow" :
        ["color", "backgroundColor", "style1"].includes(type) && tool.nativeRef.group === type && matchesNativeStyle(styles, tool.nativeRef)));
      if (found && !result.some(tool => tool.id === found.id)) result.push(found);
    }
    return result;
  }
}
export const nativeStyles = new NativeStyleLibrary();
export function nativeUnavailableMessage(): string {
  return nativeStyles.status === "ready" ? t("原生样式已删除，请重新选择") : nativeStyles.status === "loading" ? t("正在同步思源样式…") : t("原生样式暂不可用，请同步后重试");
}
