import { t } from "./i18n";
import { canonicalValue, STYLE_PROPERTIES, type Annotation, type AnnotationTool, type NativeMark } from "./model";

export interface Appearance { marks: NativeMark[]; styles: Record<string, string> }
export type ColorEnvironment = Record<string, string>;
export const GRAY = "#9aa0a6";
export const MARK_BACKGROUND = "var(--b3-protyle-inline-mark-background, var(--b3-font-background12))";
export const VISUAL_MARKS = new Set(["mark", "u", "strong", "em", "s", "sup", "sub"]);
export function appearanceOf(annotation: Pick<Annotation, "signature">): Appearance {
  try {
    const [marks, entries] = JSON.parse(annotation.signature);
    if (!Array.isArray(marks) || !Array.isArray(entries)) throw new Error();
    return {
      marks: marks.filter((mark): mark is NativeMark => VISUAL_MARKS.has(mark)),
      styles: Object.fromEntries(entries.filter((entry) => Array.isArray(entry) &&
        typeof entry[0] === "string" && typeof entry[1] === "string" &&
        STYLE_PROPERTIES.has(entry[0]) && !/url\s*\(|expression\s*\(/i.test(entry[1]))),
    };
  } catch { return { marks: [], styles: {} }; }
}
export function visibleColor(value?: string): string | undefined {
  if (!value || value.trim().toLowerCase() === "transparent" ||
    /^(?:rgba|hsla)\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/i.test(value.trim())) return undefined;
  return value;
}
export function resolveValue(value: string, env: ColorEnvironment = {}): string {
  let result = value;
  for (let i = 0; i < 12 && result.includes("var("); i++) {
    const next = result.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (all, key, fallback) => env[key]?.trim() || fallback?.trim() || all);
    if (next === result) break;
    result = next;
  }
  return canonicalValue(result).replace(/^rgba\((\d+),(\d+),(\d+),1\)$/, "rgb($1,$2,$3)");
}
export function readColorEnvironment(): ColorEnvironment {
  const computed = getComputedStyle(document.documentElement);
  const env: ColorEnvironment = {};
  for (let i = 0; i < computed.length; i++) {
    const property = computed[i];
    if (property.startsWith("--")) env[property] = computed.getPropertyValue(property).trim();
  }
  // Some engines do not enumerate custom properties.
  for (let i = 1; i <= 20; i++) for (const prefix of ["--b3-font-background", "--b3-font-color"])
    env[prefix + i] = computed.getPropertyValue(prefix + i).trim();
  env["--b3-protyle-inline-mark-background"] = computed.getPropertyValue("--b3-protyle-inline-mark-background").trim();
  return env;
}
export function appearanceLabel(appearance: Appearance, env: ColorEnvironment = {}): string {
  const p = visualProperties(appearance, env);
  const labels: string[] = [];
  if (p.color) labels.push(t("字色 {0}", p.color));
  if (p["background-color"]) labels.push(t("背景 {0}", p["background-color"]));
  if (p["text-decoration-line"]?.includes("underline")) labels.push(({ solid: t("下划线"), wavy: t("波浪线"), dotted: t("点线"), dashed: t("虚线"), double: t("双线") } as Record<string, string>)[p["text-decoration-style"]] || t("下划线"));
  if (p["text-decoration-line"]?.includes("line-through")) labels.push(t("删除线"));
  if (p["font-weight"] === "bold") labels.push(t("加粗"));
  if (p["font-style"] === "italic") labels.push(t("斜体"));
  if (p["vertical-align"]) labels.push(p["vertical-align"] === "super" ? t("上标") : t("下标"));
  if (p["text-shadow"]) labels.push(t("阴影"));
  if (p["-webkit-text-stroke"]) labels.push(t("空心"));
  if (p["font-size"]) labels.push(p["font-size"]);
  if (p["font-family"]) labels.push(p["font-family"]);
  return labels.join(" · ") || t("默认样式");
}
export function stripColors(appearance: Appearance): { foreground: string; background: string } {
  return {
    foreground: visibleColor(appearance.styles.color) || GRAY,
    background: visibleColor(appearance.styles["background-color"]) || (appearance.marks.includes("mark") ? MARK_BACKGROUND : GRAY),
  };
}
export function paintStrip(node: HTMLElement, appearance: Appearance): void {
  const colors = stripColors(appearance);
  node.classList.add("sya-style-strip");
  node.style.setProperty("--sya-mark-foreground", colors.foreground);
  node.style.setProperty("--sya-mark-background", colors.background);
}
/** Canonical visual properties, independent of links, references and tool identities. */
export function visualProperties(appearance: Appearance, env: ColorEnvironment = {}): Record<string, string> {
  const result: Record<string, string> = {};
  const styles = appearance.styles;
  for (const [key, value] of Object.entries(styles)) {
    if (key === "text-decoration" || key === "text-decoration-line") continue;
    const resolved = resolveValue(value, env);
    if ((key === "color" || key === "background-color") && !visibleColor(resolved)) continue;
    if (resolved && resolved !== "normal" && resolved !== "none") result[key] = resolved;
  }
  if (appearance.marks.includes("mark") && !result["background-color"])
    result["background-color"] = resolveValue(MARK_BACKGROUND, env);
  for (const mark of appearance.marks) {
    if (mark === "strong" && !styles["font-weight"]) result["font-weight"] = "bold";
    if (mark === "em" && !styles["font-style"]) result["font-style"] = "italic";
    if ((mark === "sup" || mark === "sub") && !styles["vertical-align"]) result["vertical-align"] = mark === "sup" ? "super" : "sub";
  }
  if (result["font-weight"] === "700") result["font-weight"] = "bold";
  const shorthand = styles["text-decoration"] || "";
  const line = styles["text-decoration-line"] || shorthand;
  const lines = new Set<string>();
  if (appearance.marks.includes("u") || line.includes("underline")) lines.add("underline");
  if (appearance.marks.includes("s") || line.includes("line-through")) lines.add("line-through");
  if (lines.size) {
    result["text-decoration-line"] = [...lines].sort().join(" ");
    result["text-decoration-style"] ||= /\b(wavy|dotted|dashed|double|solid)\b/.exec(shorthand)?.[1] || "solid";
  } else {
    delete result["text-decoration-style"];
    delete result["text-decoration-color"];
  }
  return result;
}
export function visualSignature(appearance: Appearance, env: ColorEnvironment = {}): string {
  return JSON.stringify(Object.entries(visualProperties(appearance, env)).sort(([a], [b]) => a.localeCompare(b)));
}
export function matchesTool(appearance: Appearance, tool: AnnotationTool, env: ColorEnvironment = {}): boolean {
  const expected = visualProperties(tool, env);
  const actual = visualProperties(appearance, env);
  return Object.keys(expected).length > 0 && Object.entries(expected).every(([key, value]) =>
    key === "text-decoration-line"
      ? value.split(" ").every((line) => actual[key]?.split(" ").includes(line))
      : actual[key] === value);
}
