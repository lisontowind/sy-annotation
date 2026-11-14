import type { Annotation, AnnotationTool } from "./model";
import { matchesNativeStyle, nativeDefaultGroup, nativeRef } from "./native-styles";
import { appearanceOf, resolveValue, visualProperties, visualSignature, resolveSignature, type Appearance, type ColorEnvironment } from "./appearance";

export type RuleField = "nativeStyle" | "tool" | "signature" | "color" | "background-color" | "line" | "strong" | "em" | "s" | "sup" | "sub" | "shadow" | "hollow" | "heading";
export type FilterRule = { kind: "group"; op: "and" | "or"; children: FilterRule[] } |
  { kind: "condition"; field: RuleField; value: string; exclude: boolean };
export interface AnnotationQuery { search: string; quick: string; rule: FilterRule; }
export interface QueryRequest { rootId: string; version: number; query: AnnotationQuery; environment: ColorEnvironment; catalogRevision?: number; }
export interface QueryResult { rootId: string; version: number; keys: string[]; catalogRevision?: number; }
export const emptyRule = (): FilterRule => ({ kind: "group", op: "and", children: [] });
export const emptyQuery = (): AnnotationQuery => ({ search: "", quick: "all", rule: emptyRule() });
export function ruleCount(rule: FilterRule): number { return rule.kind === "group" ? rule.children.reduce((sum, child) => sum + ruleCount(child), 0) : 1; }
export function validRule(rule: FilterRule): boolean {
  return rule.kind === "group" ? rule.children.every(validRule) : rule.value !== "";
}
export class QueryEngine {
  private cache = new Map<string, Appearance>();
  private propertiesCache = new Map<string, Record<string, string>>();
  private signatures = new Map<string, string>();
  private expectedSignatures = new Map<string, string | undefined>();
  private toolMatches = new Map<string, Map<string, boolean>>();
  private expectedTools = new Map<string, Record<string, string>>();
  private searchable = new WeakMap<Annotation, string>();
  constructor(private tools: AnnotationTool[], private environment: ColorEnvironment = {}) {}
  appearance(annotation: Annotation): Appearance {
    let result = this.cache.get(annotation.signature);
    if (!result) { result = appearanceOf(annotation); this.cache.set(annotation.signature, result); }
    return result;
  }
  private properties(annotation: Annotation): Record<string, string> {
    let value = this.propertiesCache.get(annotation.signature);
    if (!value) { value = visualProperties(this.appearance(annotation), this.environment); this.propertiesCache.set(annotation.signature, value); }
    return value;
  }
  private tool(annotation: Annotation, id: string): boolean {
    let matches = this.toolMatches.get(annotation.signature);
    if (!matches) { matches = new Map(); this.toolMatches.set(annotation.signature, matches); }
    if (matches.has(id)) return matches.get(id)!;
    const ref = nativeRef(id);
    if (ref) { const matched = matchesNativeStyle(this.appearance(annotation).styles, ref); matches.set(id, matched); return matched; }
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) return false;
    let expected = this.expectedTools.get(id);
    if (!expected) { expected = visualProperties(tool, this.environment); this.expectedTools.set(id, expected); }
    const actual = this.properties(annotation);
    const matched = Object.keys(expected).length > 0 && Object.entries(expected).every(([key, value]) => key === "text-decoration-line"
      ? value.split(" ").every((line) => actual[key]?.split(" ").includes(line)) : actual[key] === value);
    matches.set(id, matched); return matched;
  }
  matches(annotation: Annotation, query: AnnotationQuery, search = query.search.trim().toLocaleLowerCase()): boolean {
    if (query.quick !== "all") {
      if (query.quick === "other" ? this.tools.some((tool) => !nativeDefaultGroup(tool.nativeRef) && this.tool(annotation, tool.id)) : !this.tool(annotation, query.quick)) return false;
    }
    if (search) {
      let text = this.searchable.get(annotation);
      if (text === undefined) { text = `${annotation.text} ${annotation.headings.map((h) => h.text).join(" ")}`.toLocaleLowerCase(); this.searchable.set(annotation, text); }
      if (!text.includes(search)) return false;
    }
    return this.rule(annotation, query.rule);
  }
  rule(annotation: Annotation, rule: FilterRule): boolean {
    if (rule.kind === "group") return !rule.children.length || (rule.op === "and" ? rule.children.every((r) => this.rule(annotation, r)) : rule.children.some((r) => this.rule(annotation, r)));
    if (!rule.value) return false;
    const p = this.properties(annotation);
    let matched = false;
    switch (rule.field) {
      case "nativeStyle": { const ref = nativeRef(rule.value); matched = !!ref && matchesNativeStyle(this.appearance(annotation).styles, ref); break; }
      case "tool": matched = this.tool(annotation, rule.value); break;
      case "signature": {
        let signature = this.signatures.get(annotation.signature);
        if (!signature) { signature = visualSignature(this.appearance(annotation), this.environment); this.signatures.set(annotation.signature, signature); }
        if (!this.expectedSignatures.has(rule.value)) this.expectedSignatures.set(rule.value, resolveSignature(rule.value, this.environment));
        matched = signature === this.expectedSignatures.get(rule.value); break;
      }
      case "heading": matched = rule.value === "__intro__" ? !annotation.headings.length : annotation.headings.some((h) => h.id === rule.value); break;
      case "color": case "background-color": matched = (p[rule.field] || "__unset__") === resolveValue(rule.value, this.environment); break;
      case "line": matched = p["text-decoration-line"]?.includes("underline") ? p["text-decoration-style"] === rule.value : rule.value === "__unset__"; break;
      default: {
        const effect = { strong: p["font-weight"] === "bold", em: p["font-style"] === "italic", s: !!p["text-decoration-line"]?.includes("line-through"), sup: p["vertical-align"] === "super", sub: p["vertical-align"] === "sub", shadow: !!p["text-shadow"], hollow: !!p["-webkit-text-stroke"] }[rule.field];
        matched = effect === (rule.value === "yes");
      }
    }
    return rule.exclude ? !matched : matched;
  }
  select(annotations: Annotation[], query: AnnotationQuery): Annotation[] {
    const search = query.search.trim().toLocaleLowerCase();
    return annotations.filter((a) => this.matches(a, query, search));
  }
}
