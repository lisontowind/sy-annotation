import { appearanceOf, resolveValue, visibleColor, type Appearance } from "./appearance";
import { parseAnnotations, type AnnotationTool } from "./model";
import type { ReplacementBlock } from "./replacement";
import { browserColor, COLOR_PROPERTIES, isFixedColor, type ColorProperty } from "./theme-colors";

export interface ColorMapping { property: ColorProperty; from: string; to: string; }
export interface ColorCandidate { key: string; property: ColorProperty; value: string; count: number; }
export function repairCandidates(appearances: Appearance[]): ColorCandidate[] {
  const result = new Map<string, ColorCandidate>();
  for (const appearance of appearances) for (const property of COLOR_PROPERTIES) {
    const value = appearance.styles[property];
    if (!value || !isFixedColor(value) || !visibleColor(value)) continue;
    const normalized = resolveValue(value), key = JSON.stringify([property, normalized]);
    const candidate = result.get(key) || { key, property, value: normalized, count: 0 };
    candidate.count++; result.set(key, candidate);
  }
  return [...result.values()];
}
export function repairAppearance(appearance: Appearance, mappings: ColorMapping[]): Appearance {
  const styles = { ...appearance.styles };
  for (const { property, from, to } of mappings)
    if (appearance.styles[property] && resolveValue(appearance.styles[property]) === resolveValue(from)) styles[property] = to;
  return { marks: [...appearance.marks], styles };
}
export function repairTools(tools: AnnotationTool[], mappings: ColorMapping[]): AnnotationTool[] {
  return tools.map(tool => {
    const result = { ...tool, ...repairAppearance(tool, mappings) };
    if (JSON.stringify(result.styles) === JSON.stringify(tool.styles)) return result;
    result.color = result.styles.color || result.styles["background-color"] || result.styles["text-decoration-color"] || tool.color;
    return result;
  });
}
/** Edit declarations in place, preserving all non-color properties, mark types and link/reference attributes. */
export function repairBlock(html: string, mappings: ColorMapping[], tools: AnnotationTool[]): ReplacementBlock {
  const template = document.createElement("template"); template.innerHTML = html;
  const block = template.content.querySelector<HTMLElement>("[data-node-id]");
  if (!block) throw new Error("Missing block");
  const annotations = parseAnnotations(html, tools).annotations.filter(a => a.blockId === block.dataset.nodeId);
  const count = annotations.filter(a => {
    const before = appearanceOf(a);
    return JSON.stringify(before.styles) !== JSON.stringify(repairAppearance(before, mappings).styles);
  }).length;
  if (!count) return { id: block.dataset.nodeId!, before: html, after: html, count: 0 };
  const visit = (element: HTMLElement) => {
    if (element !== block && (element.dataset.nodeId || element.contentEditable === "false" ||
      element.matches('.protyle-attr, .protyle-action, [data-type~="inline-math"], script, style'))) return;
    const source = Object.fromEntries(COLOR_PROPERTIES.map(property => [property, element.style.getPropertyValue(property)]));
    for (const { property, from, to } of mappings) {
      const value = source[property];
      if (value && resolveValue(value) === resolveValue(from)) element.style.setProperty(property, browserColor(to), element.style.getPropertyPriority(property));
    }
    for (const child of element.children) if (child instanceof HTMLElement) visit(child);
  };
  visit(block);
  return { id: block.dataset.nodeId!, before: html, after: block.outerHTML, count };
}
