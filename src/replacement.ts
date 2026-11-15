import { t } from "./i18n";
import { annotationRuns, cleanText, parseAnnotations, STYLE_PROPERTIES, type Annotation, type AnnotationTool } from "./model";
import { appearanceOf, replacementSignature, VISUAL_MARKS, type Appearance, type ColorEnvironment } from "./appearance";
import { browserColor } from "./theme-colors";

export type ReplacementMode = "replace" | "preserve";
export interface ReplacementProgress {
  phase: "preparing" | "validating" | "saving" | "verifying" | "done";
  completed: number;
  total: number;
  message?: string;
}
export type ProgressReporter = (progress: ReplacementProgress) => void;
export interface ReplacementBlock { id: string; before: string; after: string; count: number; }
export interface BlockEditPlan {
  rootId: string; blocks: ReplacementBlock[];
  matched: number; changed: number; examples: { before: Annotation; after: Appearance }[];
}
export interface ReplacementPlan extends BlockEditPlan { target: AnnotationTool; mode: ReplacementMode; }
export function snapshotBlocks(html: string, ids: string[]): Map<string, string> {
  const template = document.createElement("template"); template.innerHTML = html;
  const wanted = new Set(ids);
  const result = new Map<string, string>();
  for (const block of template.content.querySelectorAll<HTMLElement>("[data-node-id]")) {
    if (wanted.has(block.dataset.nodeId!)) result.set(block.dataset.nodeId!, block.outerHTML);
  }
  for (const id of ids) if (!result.has(id)) throw new Error(t("部分原文块已不存在，请重新预览"));
  return result;
}
const PRESERVED = new Set(["font-weight", "font-style", "vertical-align", "font-size", "font-family"]);
const TAG_MARKS: Record<string, string> = { MARK: "mark", U: "u", STRONG: "strong", B: "strong", EM: "em", I: "em", S: "s", DEL: "s", SUP: "sup", SUB: "sub" };
function removedMark(mark: string, target: AnnotationTool, mode: ReplacementMode): boolean {
  return VISUAL_MARKS.has(mark) && (mode === "replace" || ["mark", "u", "s"].includes(mark) ||
    mark === "sup" && target.marks.includes("sub") || mark === "sub" && target.marks.includes("sup"));
}
export function replacedAppearance(source: Appearance, target: AnnotationTool, mode: ReplacementMode): Appearance {
  const marks = source.marks.filter((mark) => !removedMark(mark, target, mode));
  const styles = Object.fromEntries(Object.entries(source.styles).filter(([key]) => mode === "preserve" && PRESERVED.has(key)));
  for (const mark of target.marks) if (!marks.includes(mark)) marks.push(mark);
  Object.assign(styles, target.styles);
  return { marks, styles };
}
export function replacementChanges(annotation: Annotation, target: AnnotationTool, mode: ReplacementMode, env: ColorEnvironment): boolean {
  return annotationRuns(annotation).some(run => {
    const source = appearanceOf(run);
    return replacementSignature(source, env) !== replacementSignature(replacedAppearance(source, target, mode), env);
  });
}
function stripInline(element: HTMLElement, target: AnnotationTool, mode: ReplacementMode): HTMLElement {
  const mark = TAG_MARKS[element.tagName];
  const clone = mark && removedMark(mark, target, mode) ? document.createElement("span") : element.cloneNode(false) as HTMLElement;
  if (clone.tagName !== element.tagName) for (const attribute of element.attributes) clone.setAttribute(attribute.name, attribute.value);
  const types = (element.dataset.type || "").split(" ").filter((type) => type && !removedMark(type, target, mode));
  for (const property of STYLE_PROPERTIES) if (!(mode === "preserve" && PRESERVED.has(property))) clone.style.removeProperty(property);
  if (clone.style.length && !types.includes("text")) types.push("text");
  if (!clone.style.length) { const i = types.indexOf("text"); if (i >= 0) types.splice(i, 1); clone.removeAttribute("style"); }
  if (types.length) clone.dataset.type = types.join(" "); else clone.removeAttribute("data-type");
  return clone;
}
function targetSpan(text: string, target: AnnotationTool): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  const types = [...target.marks];
  for (const [key, value] of Object.entries(target.styles)) span.style.setProperty(key, browserColor(value));
  span.setAttribute("data-type", [...types, ...(span.style.length ? ["text"] : [])].join(" "));
  return span;
}
function flattenSelected(parent: HTMLElement, selected: HTMLElement, target: AnnotationTool, mode: ReplacementMode): HTMLElement {
  const outer = stripInline(parent, target, mode);
  const span = document.createElement("span");
  const types = new Set<string>();
  const tagMark = TAG_MARKS[outer.tagName];
  if (tagMark) types.add(tagMark);
  if (outer.tagName === "A") types.add("a");
  if (outer.tagName === "CODE") types.add("code");
  for (const source of [outer, selected]) {
    for (const attribute of source.attributes) {
      if (attribute.name === "style" || attribute.name === "data-type") continue;
      span.setAttribute(attribute.name, attribute.value);
    }
    for (const type of (source.dataset.type || "").split(" ")) if (type) types.add(type);
    for (let i = 0; i < source.style.length; i++) {
      const key = source.style[i]; span.style.setProperty(key, source.style.getPropertyValue(key), source.style.getPropertyPriority(key));
    }
  }
  if (outer.tagName === "A" && outer.getAttribute("href")) span.dataset.href = outer.getAttribute("href")!;
  if (span.style.length) types.add("text");
  span.dataset.type = [...types].join(" ");
  span.append(...selected.childNodes);
  return span;
}
/** Rebuild inline ancestor paths per selected run, so inherited old styles cannot leak back in. */
export function replaceBlock(html: string, annotations: Annotation[], target: AnnotationTool, mode: ReplacementMode, env: ColorEnvironment, tools: AnnotationTool[]): ReplacementBlock {
  const id = annotations[0]?.blockId;
  if (!id || annotations.some((a) => a.blockId !== id)) throw new Error(t("标注块不一致"));
  const fresh = parseAnnotations(html, tools).annotations;
  for (const a of annotations) if (!fresh.some((b) => b.blockId === id && b.start === a.start && b.end === a.end && b.text === a.text && b.signature === a.signature && JSON.stringify(b.runs) === JSON.stringify(a.runs)))
    throw new Error(t("原文或样式已变化，请重新预览"));
  const ranges = annotations.filter((a) => replacementChanges(a, target, mode, env)).sort((a, b) => a.start - b.start);
  if (!ranges.length) return { id, before: html, after: html, count: 0 };
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end) throw new Error(t("待修改范围重叠"));
  const template = document.createElement("template"); template.innerHTML = html;
  const block = [...template.content.querySelectorAll<HTMLElement>("[data-node-id]")].find((node) => node.dataset.nodeId === id);
  if (!block) throw new Error(t("找不到原文块"));
  let offset = 0;
  type Piece = { node: Node; selected: boolean };
  const visit = (node: Node): Piece[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || "";
      const length = cleanText(raw).length;
      const start = offset; offset += length;
      const boundaries = new Set([0, length]);
      for (const range of ranges) { if (range.start > start && range.start < offset) boundaries.add(range.start - start); if (range.end > start && range.end < offset) boundaries.add(range.end - start); }
      const points = [...boundaries].sort((a, b) => a - b);
      const rawAt = (visible: number) => { let count = 0; for (let i = 0; i < raw.length; i++) { if (count === visible) return i; if (!/[\u200b\u2060\ufeff]/.test(raw[i])) count++; } return raw.length; };
      const result: Piece[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const selected = ranges.some((range) => start + points[i] >= range.start && start + points[i + 1] <= range.end);
        const text = raw.slice(rawAt(points[i]), i === points.length - 2 ? raw.length : rawAt(points[i + 1]));
        result.push({ node: selected ? targetSpan(text, target) : document.createTextNode(text), selected });
      }
      return result.length ? result : [{ node: node.cloneNode(true), selected: false }];
    }
    if (!(node instanceof HTMLElement)) return [{ node: node.cloneNode(true), selected: false }];
    if (node !== block && (node.dataset.nodeId || node.contentEditable === "false" || node.matches('.protyle-attr, .protyle-action, [data-type~="inline-math"], script, style'))) return [{ node: node.cloneNode(true), selected: false }];
    const structural = node === block || node.hasAttribute("contenteditable") || /^(DIV|P|TABLE|TBODY|THEAD|TR|TD|TH|UL|OL|LI|BLOCKQUOTE)$/.test(node.tagName);
    const pieces = [...node.childNodes].flatMap(visit);
    if (!pieces.length) return [{ node: node.cloneNode(true), selected: false }];
    if (structural) { const clone = node.cloneNode(false); pieces.forEach((p) => clone.appendChild(p.node)); return [{ node: clone, selected: false }]; }
    const result: Piece[] = [];
    for (const piece of pieces) {
      if (piece.selected) {
        result.push({ node: flattenSelected(node, piece.node as HTMLElement, target, mode), selected: true });
        continue;
      }
      let group = result[result.length - 1];
      if (!group || group.selected !== piece.selected) {
        group = { node: piece.selected ? stripInline(node, target, mode) : node.cloneNode(false), selected: piece.selected };
        result.push(group);
      }
      group.node.appendChild(piece.node);
    }
    return result;
  };
  const result = visit(block)[0].node as HTMLElement;
  return { id, before: html, after: result.outerHTML, count: ranges.length };
}
