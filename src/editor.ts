import { t } from "./i18n";
import type { IProtyle } from "siyuan";
import { browserColor } from "./theme-colors";
import { nativeDefaultGroup } from "./native-styles";
import { VISUAL_MARKS, visualSignature } from "./appearance";
import {
  cleanText,
  parseStyles,
  textNodes,
  type Annotation,
  type AnnotationStyle,
  type NativeMark,
} from "./model";

export interface EditorSelection {
  protyle: IProtyle;
  range: Range;
}

function closestElement(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

const EXCLUDED =
  '[data-type="NodeCodeBlock"], [data-type="NodeBlockQueryEmbed"], [data-type="NodeHTMLBlock"], [data-type="NodeAttributeView"], [data-type="NodeCustomBlock"], [data-type~="inline-math"], [contenteditable="false"]';

export function validateSelection(protyle: IProtyle, range: Range): boolean {
  const editor = protyle.wysiwyg?.element;
  if (
    !editor?.isConnected ||
    protyle.disabled ||
    !protyle.toolbar?.setInlineMark
  )
    return false;
  if (range.collapsed || !cleanText(range.toString()).trim()) return false;
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  )
    return false;
  const start = closestElement(range.startContainer);
  const end = closestElement(range.endContainer);
  if (
    !start?.closest('[contenteditable="true"]') ||
    !end?.closest('[contenteditable="true"]')
  )
    return false;
  if (start.closest(EXCLUDED) || end.closest(EXCLUDED)) return false;
  // A drag across an embed/code block must not write any part of the unsupported selection.
  for (const excluded of editor.querySelectorAll(EXCLUDED)) {
    if (excluded.closest(".protyle-attr, .protyle-action")) continue;
    if (range.intersectsNode(excluded)) return false;
  }
  return true;
}

/** Sample authored inline formatting, keeping native references and theme expressions. */
export function readSelectionStyle(selection?: EditorSelection): Pick<AnnotationStyle, "marks" | "styles"> {
  if (!selection || !validateSelection(selection.protyle, selection.range))
    throw new Error(t("请先选中正文中有样式的文字，再点击组合样式区的加号"));
  const tags: Record<string, NativeMark> = {
    MARK: "mark", U: "u", STRONG: "strong", B: "strong", EM: "em", I: "em",
    S: "s", DEL: "s", SUP: "sup", SUB: "sub",
  };
  let sampled: Pick<AnnotationStyle, "marks" | "styles"> | undefined;
  let signature = "";
  for (const { node, start, end, block } of selectedSegments(selection.protyle, selection.range)) {
    if (!cleanText(node.data.slice(start, end)).trim()) continue;
    const ancestors: HTMLElement[] = [];
    for (let parent = node.parentElement; parent && parent !== block; parent = parent.parentElement)
      ancestors.unshift(parent);
    const marks = new Set<NativeMark>();
    const styles: Record<string, string> = {};
    for (const parent of ancestors) {
      for (const type of (parent.getAttribute("data-type") ?? "").split(/\s+/))
        if (VISUAL_MARKS.has(type)) marks.add(type as NativeMark);
      if (tags[parent.tagName]) marks.add(tags[parent.tagName]);
      Object.assign(styles, parseStyles(parent.getAttribute("style") ?? ""));
    }
    // Make CSS-only effects editable through the same controls as native inline marks.
    if (/^(bold|700)$/i.test(styles["font-weight"] ?? "")) { marks.add("strong"); delete styles["font-weight"]; }
    if (styles["font-style"] === "italic") { marks.add("em"); delete styles["font-style"]; }
    if (styles["vertical-align"] === "super") { marks.add("sup"); delete styles["vertical-align"]; }
    if (styles["vertical-align"] === "sub") { marks.add("sub"); delete styles["vertical-align"]; }
    const decoration = styles["text-decoration-line"] || styles["text-decoration"] || "";
    if (decoration.includes("underline")) marks.add("u");
    if (decoration.includes("line-through")) marks.add("s");
    const appearance = { marks: [...marks], styles };
    const currentSignature = visualSignature(appearance);
    if (sampled && signature !== currentSignature)
      throw new Error(t("选中文本包含多种样式，请选择样式一致的文字"));
    sampled ??= appearance;
    signature = currentSignature;
  }
  if (!sampled || (!sampled.marks.length && !Object.keys(sampled.styles).length))
    throw new Error(t("选中文本没有可用于组合的样式，请先设置颜色或文字效果"));
  return sampled;
}

export function applyAnnotation(
  { protyle, range }: EditorSelection,
  style: AnnotationStyle,
): boolean {
  if (!validateSelection(protyle, range)) return false;
  const defaultGroup = nativeDefaultGroup(style.nativeRef);
  if (defaultGroup) {
    protyle.toolbar!.range = range;
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    // Delegate removal to SiYuan so colors on nested inline ancestors cannot leak back in.
    protyle.toolbar!.setInlineMark(protyle, "text", "range", { type: defaultGroup, color: defaultGroup === "style1" ? "\u200b" : "" }, true);
    protyle.toolbar!.element?.classList.add("fn__none");
    return true;
  }
  const instance = protyle.getInstance?.();
  if (!instance?.updateBatchTransaction)
    throw new Error(t("当前思源编辑器缺少批量文字格式事务接口"));
  const segments = selectedSegments(protyle, range);
  if (!segments.length) return false;
  const anchors = segments.map(({ node, start, end }) => ({
    node,
    start,
    end,
  }));
  // Prepare off-document first, so repainting identical formatting never creates a no-op undo step.
  const jobs = segments
    .map((segment, index) => {
      const { node, block } = segment;
      const span = document.createElement("span");
      const ancestors: HTMLElement[] = [];
      for (
        let parent = node.parentElement;
        parent && parent !== block && parent.contentEditable !== "true";
        parent = parent.parentElement
      )
        ancestors.unshift(parent);
      const types = new Set<string>();
      const tags: Record<string, string> = {
        MARK: "mark",
        U: "u",
        STRONG: "strong",
        B: "strong",
        EM: "em",
        I: "em",
        S: "s",
        DEL: "s",
        SUP: "sup",
        SUB: "sub",
      };
      for (const parent of ancestors) {
        for (const type of (parent.getAttribute("data-type") ?? "").split(" "))
          if (type && !type.startsWith("Node")) types.add(type);
        if (tags[parent.tagName]) types.add(tags[parent.tagName]);
        for (const attribute of parent.attributes)
          if (
            (attribute.name.startsWith("data-") &&
              attribute.name !== "data-type") ||
            attribute.name === "title"
          )
            span.setAttribute(attribute.name, attribute.value);
        for (let i = 0; i < parent.style.length; i++) {
          const property = parent.style[i];
          span.style.setProperty(
            property,
            parent.style.getPropertyValue(property),
            parent.style.getPropertyPriority(property),
          );
        }
      }
      const beforeStyle = span.getAttribute("style");
      const beforeTypes = [...types].sort().join(" ");
      for (const mark of style.marks) {
        if (mark === "sup") types.delete("sub");
        if (mark === "sub") types.delete("sup");
        types.add(mark);
      }
      for (const [property, value] of Object.entries(style.styles))
        span.style.setProperty(property, browserColor(value));
      if (
        style.marks.includes("u") &&
        span.style.textDecorationStyle &&
        !style.styles["text-decoration-style"]
      )
        span.style.textDecorationStyle = "solid";
      if (span.style.textDecorationLine) {
        const lines = new Set(span.style.textDecorationLine.split(" "));
        if (types.has("u")) lines.add("underline");
        if (types.has("s")) lines.add("line-through");
        span.style.textDecorationLine = [...lines].join(" ");
      }
      if (span.style.length) types.add("text");
      span.dataset.type = [...types].join(" ");
      if (
        beforeStyle === span.getAttribute("style") &&
        beforeTypes === [...types].sort().join(" ")
      ) {
        return null;
      }
      return { segment, span, index };
    })
    .filter((job): job is NonNullable<typeof job> => job !== null);
  if (!jobs.length) return true;
  const blocks = [...new Set(jobs.map((job) => job.segment.block))];
  // One native batch means a combination, including several paragraphs, is one undo step.
  instance.updateBatchTransaction(blocks, (block) => {
    for (const { segment, span, index } of jobs) {
      if (segment.block !== block) continue;
      const { node, start, end } = segment;
      if (end < node.length) node.splitText(end);
      const selected = start ? node.splitText(start) : node;
      selected.replaceWith(span);
      span.append(selected);
      anchors[index] = { node: selected, start: 0, end: selected.length };
    }
  });
  const painted = document.createRange();
  painted.setStart(anchors[0].node, anchors[0].start);
  painted.setEnd(
    anchors[anchors.length - 1].node,
    anchors[anchors.length - 1].end,
  );
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(painted);
  protyle.toolbar!.range = painted;
  protyle.toolbar!.element?.classList.add("fn__none");
  return true;
}

export function selectedSegments(
  protyle: IProtyle,
  range: Range,
): { node: Text; start: number; end: number; block: HTMLElement }[] {
  const result: {
    node: Text;
    start: number;
    end: number;
    block: HTMLElement;
  }[] = [];
  const walker = document.createTreeWalker(
    protyle.wysiwyg!.element,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (
      !range.intersectsNode(node) ||
      node.parentElement?.closest(
        '.protyle-attr, .protyle-action, [contenteditable="false"]',
      )
    )
      continue;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end =
      range.endContainer === node ? range.endOffset : (node as Text).length;
    const block = node.parentElement?.closest<HTMLElement>("[data-node-id]");
    if (block && start < end && cleanText(node.textContent!.slice(start, end)))
      result.push({ node: node as Text, start, end, block });
  }
  return result;
}

/** Select the exact occurrence in a block when possible; fall back to the nearest matching text. */
export function focusAnnotation(
  block: HTMLElement,
  annotation?: Annotation,
): void {
  block.scrollIntoView({ behavior: "smooth", block: "center" });
  block.animate?.(
    [
      { backgroundColor: "var(--b3-theme-primary-lightest, #e8f1ff)" },
      { backgroundColor: "transparent" },
    ],
    { duration: 1300 },
  );
  if (!annotation) return;
  const nodes = textNodes(block);
  const text = nodes.map((node) => cleanText(node.data)).join("");
  let start = annotation.start;
  if (text.slice(start, annotation.end) !== annotation.text) {
    start = text.indexOf(annotation.text);
    if (start < 0) return;
  }
  const end = start + annotation.text.length;
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (const node of nodes) {
    const length = cleanText(node.data).length;
    const rawOffset = (target: number) => {
      let visible = 0;
      for (let i = 0; i < node.length; i++) {
        if (/[\u200b\ufeff]/.test(node.data[i])) continue;
        if (visible === target) return i;
        visible++;
      }
      return node.length;
    };
    if (!started && offset + length > start) {
      range.setStart(node, rawOffset(start - offset));
      started = true;
    }
    if (started && offset + length >= end) {
      range.setEnd(node, rawOffset(end - offset));
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    offset += length;
  }
}
