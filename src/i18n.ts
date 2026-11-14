import english from "../i18n/en_US.json";

export type Locale = "zh-CN" | "en-US";
let localeOverride: string | undefined;

/** SiYuan reloads frontends after a language change; never rewrite saved user data. */
export function setLocale(locale?: string): void { localeOverride = locale; }
export function getLocale(): Locale {
  const host = typeof window !== "undefined" ? window.siyuan?.config?.lang : undefined;
  const html = typeof document !== "undefined" ? document.documentElement.lang : undefined;
  const locale = (localeOverride || host || html || "zh-CN").replaceAll("_", "-").toLowerCase();
  return locale.startsWith("zh") ? "zh-CN" : "en-US";
}

export function t(message: string, ...values: unknown[]): string {
  const dictionary: Record<string, string> = english.messages;
  const template = getLocale() === "en-US" ? dictionary[message] ?? message : message;
  return template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)]) : token);
}

const defaultNames: Record<string, string> = {
  yellow: "黄色高亮", green: "绿色高亮", blue: "蓝色高亮", pink: "粉色高亮", underline: "下划线", wave: "红色波浪线",
};
/** Translate only unchanged built-in labels; custom tool names remain verbatim. */
export function toolLabel(tool?: { id: string; label: string }): string {
  if (!tool) return "";
  return defaultNames[tool.id] === tool.label ? t(tool.label) : tool.label;
}
