import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { t, toolLabel } from "./i18n";

export type NativeMark = "mark" | "u" | "strong" | "em" | "s" | "sup" | "sub";
export interface AnnotationTool {
  id: string;
  label: string;
  color: string;
  marks: NativeMark[];
  styles: Record<string, string>;
}
export type AnnotationStyle = AnnotationTool;
export interface ToolConfig {
  version: 1;
  tools: AnnotationTool[];
  selectedId: string;
}
export const STYLES: AnnotationTool[] = [
  {
    id: "yellow",
    label: "黄色高亮",
    color: "#d3a322",
    marks: [],
    styles: { "background-color": "var(--b3-font-background12)" },
  },
  {
    id: "green",
    label: "绿色高亮",
    color: "#52a47b",
    marks: [],
    styles: { "background-color": "var(--b3-font-background4)" },
  },
  {
    id: "blue",
    label: "蓝色高亮",
    color: "#568ac5",
    marks: [],
    styles: { "background-color": "var(--b3-font-background3)" },
  },
  {
    id: "pink",
    label: "粉色高亮",
    color: "#cc7b9b",
    marks: [],
    styles: { "background-color": "var(--b3-font-background9)" },
  },
  {
    id: "underline",
    label: "下划线",
    color: "#8b849b",
    marks: ["u"],
    styles: {},
  },
  {
    id: "wave",
    label: "红色波浪线",
    color: "#c65c68",
    marks: ["u"],
    styles: {
      "text-decoration-line": "underline",
      "text-decoration-style": "wavy",
      "text-decoration-color": "#c65c68",
    },
  },
];
export const STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-shadow",
  "-webkit-text-stroke",
  "-webkit-text-fill-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "vertical-align",
]);
export const cleanText = (text: string) => text.replace(/[\u200b\ufeff]/g, "");
export function parseStyles(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(";")
      .map((part) => {
        const index = part.indexOf(":");
        return [
          part.slice(0, index).trim().toLowerCase(),
          part.slice(index + 1).trim(),
        ];
      })
      .filter(
        ([key, val]) =>
          STYLE_PROPERTIES.has(key) &&
          val &&
          !/url\s*\(|expression\s*\(/i.test(val),
      ),
  );
}
export function canonicalValue(value: string): string {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (hex) {
    const color =
      hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return `rgb(${[0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16)).join(",")})`;
  }
  return value.trim().replace(/\s*,\s*/g, ",");
}
export function styleSignature(
  marks: string[],
  styles: Record<string, string>,
): string {
  return JSON.stringify([
    [...new Set(marks)].sort(),
    Object.entries(styles)
      .filter(([, value]) => value)
      .map(([key, value]) => [key, canonicalValue(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
export function loadToolConfig(
  data: unknown,
  legacy?: { styleId?: string } | null,
): ToolConfig {
  const source = data as Partial<ToolConfig> | null;
  const tools =
    source?.version === 1 && Array.isArray(source.tools)
      ? source.tools
          .filter(
            (tool) =>
              tool &&
              typeof tool.id === "string" &&
              typeof tool.label === "string" &&
              typeof tool.color === "string" &&
              Array.isArray(tool.marks) &&
              tool.styles &&
              typeof tool.styles === "object",
          )
          .map(
            (tool) =>
              ({
                ...tool,
                marks: tool.marks.filter((mark) =>
                  ["mark", "u", "strong", "em", "s", "sup", "sub"].includes(
                    mark,
                  ),
                ),
                styles: Object.fromEntries(
                  Object.entries(tool.styles).filter(
                    ([key, value]) =>
                      STYLE_PROPERTIES.has(key) &&
                      typeof value === "string" &&
                      !/url\s*\(|expression\s*\(/i.test(value),
                  ),
                ),
              }) as AnnotationTool,
          )
      : structuredClone(STYLES);
  const selected = source?.selectedId ?? legacy?.styleId ?? "yellow";
  return {
    version: 1,
    tools,
    selectedId: tools.some((tool) => tool.id === selected)
      ? selected
      : (tools[0]?.id ?? ""),
  };
}
export interface Heading {
  id: string;
  text: string;
  level: number;
}
export interface Annotation {
  key: string;
  blockId: string;
  text: string;
  start: number;
  end: number;
  styleId: string;
  label: string;
  color: string;
  signature: string;
  headings: Heading[];
}
export interface OutlineNode {
  heading: Heading | null;
  annotations: Annotation[];
  children: OutlineNode[];
  count: number;
}
export interface BlockInfo {
  id: string;
  parentId: string;
  type: string;
  headings: Heading[];
}
export interface DocumentIndex {
  annotations: Annotation[];
  headings: Heading[];
  blocks: Record<string, BlockInfo>;
  order: string[];
}
export interface AnnotationDelta {
  updatedBlocks: string[];
  annotations: { blockId: string; annotations: Annotation[] }[];
}
const orderPositions = new WeakMap<string[], Map<string, number>>();
/** Merge affected runs in document order, preserving every unaffected annotation object. */
export function applyAnnotationDelta(index: DocumentIndex, delta: AnnotationDelta): void {
  if (!delta.annotations.length) return;
  let positions = orderPositions.get(index.order);
  if (!positions) { positions = new Map(index.order.map((id, i) => [id, i])); orderPositions.set(index.order, positions); }
  const changed = new Set(delta.annotations.map((entry) => entry.blockId));
  const replacements = delta.annotations.flatMap((entry) => entry.annotations).sort((a, b) => (positions!.get(a.blockId)! - positions!.get(b.blockId)!) || a.start - b.start);
  const result: Annotation[] = []; let cursor = 0;
  for (const annotation of index.annotations) {
    if (changed.has(annotation.blockId)) continue;
    while (cursor < replacements.length && positions.get(replacements[cursor].blockId)! < positions.get(annotation.blockId)!) result.push(replacements[cursor++]);
    result.push(annotation);
  }
  while (cursor < replacements.length) result.push(replacements[cursor++]);
  index.annotations = result;
}
export interface BlockChange {
  action: "update" | "insert" | "delete" | "move";
  id: string;
  html?: string;
  parentId?: string;
  previousId?: string;
  nextId?: string;
}
export function textNodes(block: Element): Text[] {
  const walker = block.ownerDocument.createTreeWalker(block, 4);
  const result: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest("[data-node-id]") !== block ||
      parent.closest(
        '.protyle-attr, .protyle-action, [contenteditable="false"], script, style',
      )
    )
      continue;
    result.push(node as Text);
  }
  return result;
}
type AstNode = DefaultTreeAdapterMap["node"];
type AstElement = DefaultTreeAdapterMap["element"];
type AstParent = DefaultTreeAdapterMap["parentNode"];
const attrs = (node: AstNode): Record<string, string> =>
  "attrs" in node
    ? Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value]))
    : {};
const children = (node: AstNode): AstNode[] =>
  "childNodes" in node ? node.childNodes : [];
const EXCLUDED = new Set([
  "NodeCodeBlock",
  "NodeBlockQueryEmbed",
  "NodeHTMLBlock",
  "NodeAttributeView",
  "NodeCustomBlock",
]);
function describe(
  marks: string[],
  styles: Record<string, string>,
  tools: AnnotationTool[],
) {
  const background = styles["background-color"];
  const underlined =
    marks.includes("u") ||
    (
      styles["text-decoration-line"] ??
      styles["text-decoration"] ??
      ""
    ).includes("underline");
  const matched = tools
    .filter(
      (tool) =>
        (tool.marks.length || Object.keys(tool.styles).length) &&
        tool.marks.every((mark) => marks.includes(mark)) &&
        (!tool.marks.includes("u") ||
          (tool.styles["text-decoration-style"] || "solid") ===
            (styles["text-decoration-style"] || "solid")) &&
        Object.entries(tool.styles).every(
          ([key, value]) =>
            canonicalValue(styles[key] ?? "") === canonicalValue(value),
        ),
    )
    .sort(
      (a, b) =>
        b.marks.length +
        Object.keys(b.styles).length -
        (a.marks.length + Object.keys(a.styles).length),
    )[0];
  const marked = marks.includes("mark");
  const visibleBackground =
    background && !["transparent", "rgba(0, 0, 0, 0)"].includes(background);
  if (
    !matched &&
    !visibleBackground &&
    !underlined &&
    !marked &&
    !styles.color &&
    !marks.includes("s") &&
    !styles["text-shadow"] &&
    !styles["-webkit-text-stroke"]
  )
    return null;
  const wave = styles["text-decoration-style"] === "wavy";
  return {
    styleId:
      matched?.id ??
      (marked ? "yellow" : underlined && !wave ? "underline" : "other"),
    color:
      matched?.color ??
      (visibleBackground
        ? background
        : styles["text-decoration-color"] || styles.color) ??
      (marked ? STYLES[0].color : STYLES[4].color),
    label:
      (matched ? toolLabel(matched) : undefined) ??
      (marked
        ? t("黄色高亮")
        : wave
          ? t("波浪线")
          : underlined
            ? t("下划线")
            : t("其他样式")),
    signature: styleSignature(marks, styles),
  };
}
interface OwnContent {
  text: string;
  annotations: Omit<Annotation, "headings">[];
}
function ownContent(block: AstElement, tools: AnnotationTool[]): OwnContent {
  const id = attrs(block)["data-node-id"];
  let offset = 0;
  let previous: Omit<Annotation, "headings"> | null = null;
  const result: OwnContent = { text: "", annotations: [] };
  function visit(
    node: AstNode,
    inheritedMarks: string[],
    inheritedStyles: Record<string, string>,
  ) {
    if (node !== block) {
      const a = attrs(node);
      if (
        a["data-node-id"] ||
        a.contenteditable === "false" ||
        /(?:^|\s)protyle-(?:attr|action)(?:\s|$)/.test(a.class ?? "") ||
        ["script", "style"].includes(node.nodeName)
      )
        return;
    }
    if (node.nodeName === "#text" && "value" in node) {
      const text = cleanText(node.value);
      if (!text) return;
      result.text += text;
      const format = describe(inheritedMarks, inheritedStyles, tools);
      if (format) {
        if (
          previous &&
          previous.signature === format.signature &&
          previous.end === offset
        ) {
          previous.text += text;
          previous.end += text.length;
        } else {
          previous = {
            key: `${id}:${offset}:${format.signature}`,
            blockId: id,
            text,
            start: offset,
            end: offset + text.length,
            ...format,
          };
          result.annotations.push(previous);
        }
      } else previous = null;
      offset += text.length;
      return;
    }
    const a = attrs(node);
    const tags: Record<string, string> = {
      mark: "mark",
      u: "u",
      strong: "strong",
      b: "strong",
      em: "em",
      i: "em",
      s: "s",
      del: "s",
      sup: "sup",
      sub: "sub",
    };
    const marks = [
      ...new Set([
        ...inheritedMarks,
        ...(node === block
          ? []
          : (a["data-type"] ?? "")
              .split(" ")
              .filter(
                (type) => type && !type.startsWith("Node") && type !== "text",
              )),
        ...(tags[node.nodeName] ? [tags[node.nodeName]] : []),
      ]),
    ];
    const styles = {
      ...inheritedStyles,
      ...(node === block ? {} : parseStyles(a.style ?? "")),
    };
    for (const child of children(node)) visit(child, marks, styles);
  }
  visit(block, [], {});
  result.annotations = result.annotations.filter((item) => item.text.trim());
  return result;
}
/** AST and unchanged block parses stay in the worker; patches only reparse changed subtrees. */
export class IndexEngine {
  private root: AstParent = parseFragment("");
  private nodes = new Map<string, AstElement>();
  private cache = new WeakMap<AstElement, OwnContent>();
  private current?: DocumentIndex;
  private annotationGroups = new Map<string, Annotation[]>();
  constructor(
    private rootId = "",
    private tools: AnnotationTool[] = STYLES,
  ) {}
  load(dom: string): DocumentIndex {
    this.root = parseFragment(dom);
    this.cache = new WeakMap();
    return this.snapshot();
  }
  setTools(tools: AnnotationTool[]): DocumentIndex {
    this.tools = tools;
    this.cache = new WeakMap();
    return this.snapshot();
  }
  private snapshot(): DocumentIndex {
    const result: DocumentIndex = {
      annotations: [],
      headings: [],
      blocks: {},
      order: [],
    };
    const stack: Heading[] = [];
    this.annotationGroups.clear();
    this.nodes.clear();
    const visit = (node: AstNode, parentId: string) => {
      const a = attrs(node);
      const id = a["data-node-id"];
      if (EXCLUDED.has(a["data-type"])) return;
      if (id && "tagName" in node && !this.nodes.has(id)) {
        this.nodes.set(id, node);
        let own = this.cache.get(node);
        if (!own) {
          own = ownContent(node, this.tools);
          this.cache.set(node, own);
        }
        if (a["data-type"] === "NodeHeading") {
          const level = Number(a["data-subtype"]?.replace("h", ""));
          if (level >= 1 && level <= 6) {
            const heading = { id, level, text: own.text.trim() || t("无标题") };
            while (stack.length && stack[stack.length - 1].level >= level)
              stack.pop();
            stack.push(heading);
            result.headings.push(heading);
          }
        }
        result.blocks[id] = {
          id,
          parentId,
          type: a["data-type"] ?? "",
          headings: [...stack],
        };
        result.order.push(id);
        const annotations = own.annotations.map((annotation) => ({ ...annotation, headings: [...stack] }));
        this.annotationGroups.set(id, annotations);
        result.annotations.push(...annotations);
      }
      for (const child of children(node)) visit(child, id || parentId);
    };
    visit(this.root, this.rootId);
    this.current = result;
    return result;
  }
  /** Leaf text/format edits do not need to walk, clone or transfer the whole document. */
  patchIncremental(changes: BlockChange[]): DocumentIndex | AnnotationDelta | null {
    if (!this.current) return null;
    const incoming = new Map<string, AstElement>();
    const hasBlocks = (node: AstNode): boolean => children(node).some((child) => !!attrs(child)["data-node-id"] || hasBlocks(child));
    for (const change of changes) {
      const current = this.nodes.get(change.id);
      if (change.action !== "update" || !change.html || !current?.parentNode || attrs(current)["data-type"] === "NodeHeading" || hasBlocks(current)) return this.patch(changes);
      const replacement = parseFragment(change.html).childNodes.find((node) => attrs(node)["data-node-id"] === change.id);
      if (!replacement || !("tagName" in replacement) || attrs(replacement)["data-type"] !== attrs(current)["data-type"] || hasBlocks(replacement)) return this.patch(changes);
      incoming.set(change.id, replacement);
    }
    const delta: AnnotationDelta = { updatedBlocks: [...incoming.keys()], annotations: [] };
    for (const [id, replacement] of incoming) {
      const current = this.nodes.get(id)!;
      replacement.parentNode = current.parentNode;
      current.parentNode!.childNodes.splice(current.parentNode!.childNodes.indexOf(current), 1, replacement);
      this.nodes.set(id, replacement);
      const own = ownContent(replacement, this.tools); this.cache.set(replacement, own);
      const annotations = own.annotations.map((a) => ({ ...a, headings: this.current!.blocks[id].headings }));
      const previous = this.annotationGroups.get(id) ?? [];
      if (JSON.stringify(previous) !== JSON.stringify(annotations)) {
        this.annotationGroups.set(id, annotations); delta.annotations.push({ blockId: id, annotations });
      }
    }
    applyAnnotationDelta(this.current, delta);
    return delta;
  }
  patch(changes: BlockChange[]): DocumentIndex | null {
    for (const change of changes)
      if (
        !change.id ||
        !["update", "delete", "insert", "move"].includes(change.action) ||
        ((change.action === "update" || change.action === "insert") &&
          !change.html)
      )
        return null;
    for (const change of changes) {
      const current = this.nodes.get(change.id);
      if (change.action === "delete") {
        if (current?.parentNode)
          current.parentNode.childNodes.splice(
            current.parentNode.childNodes.indexOf(current),
            1,
          );
      } else if (change.action === "update") {
        if (!current?.parentNode) return null;
        const fragment = parseFragment(change.html!);
        const replacement = fragment.childNodes.find(
          (node) => attrs(node)["data-node-id"] === change.id,
        );
        if (!replacement || !("parentNode" in replacement)) return null;
        replacement.parentNode = current.parentNode;
        current.parentNode.childNodes.splice(
          current.parentNode.childNodes.indexOf(current),
          1,
          replacement as AstElement,
        );
        // A leaf formatting edit cannot affect the node lookup outside this block.
        const hasBlockChildren = (node: AstNode): boolean => children(node).some((child) => !!attrs(child)["data-node-id"] || hasBlockChildren(child));
        if (!hasBlockChildren(current) && !hasBlockChildren(replacement)) {
          this.nodes.set(change.id, replacement as AstElement);
          continue;
        }
      } else {
        const previous = change.previousId
          ? this.nodes.get(change.previousId)
          : undefined;
        const next = change.nextId ? this.nodes.get(change.nextId) : undefined;
        const parent =
          change.parentId === this.rootId
            ? (this.nodes.get(this.rootId) ?? this.root)
            : change.parentId
              ? this.nodes.get(change.parentId)
              : (previous?.parentNode ?? next?.parentNode);
        if (
          !parent ||
          !("childNodes" in parent) ||
          (change.previousId && !previous) ||
          (change.nextId && !next) ||
          (previous && previous.parentNode !== parent) ||
          (next && next.parentNode !== parent)
        )
          return null;
        const incoming =
          change.action === "move"
            ? current
            : parseFragment(change.html!).childNodes.find(
                (node) => attrs(node)["data-node-id"] === change.id,
              );
        if (
          !incoming ||
          !("parentNode" in incoming) ||
          incoming === parent ||
          previous === incoming ||
          next === incoming
        )
          return null;
        for (
          let ancestor: AstParent | null = parent;
          ancestor;
          ancestor = "parentNode" in ancestor ? ancestor.parentNode : null
        )
          if (ancestor === incoming) return null;
        if (current?.parentNode)
          current.parentNode.childNodes.splice(
            current.parentNode.childNodes.indexOf(current),
            1,
          );
        incoming.parentNode = parent;
        parent.childNodes.splice(
          previous
            ? parent.childNodes.indexOf(previous) + 1
            : next
              ? parent.childNodes.indexOf(next)
              : 0,
          0,
          incoming as AstElement,
        );
      }
      this.reindexNodes();
    }
    return this.snapshot();
  }
  private reindexNodes() {
    this.nodes.clear();
    const visit = (node: AstNode) => {
      const id = attrs(node)["data-node-id"];
      if (id && "tagName" in node) this.nodes.set(id, node);
      for (const child of children(node)) visit(child);
    };
    visit(this.root);
  }
}
export function parseAnnotations(
  dom: string,
  tools: AnnotationTool[] = STYLES,
): DocumentIndex {
  return new IndexEngine("", tools).load(dom);
}
export function buildOutline(
  annotations: Annotation[],
  search = "",
  style = "all",
): OutlineNode {
  const root: OutlineNode = {
    heading: null,
    annotations: [],
    children: [],
    count: 0,
  };
  const query = search.trim().toLocaleLowerCase();
  const lookup = new Map<string, OutlineNode>();
  for (const annotation of annotations) {
    if (
      (style !== "all" && annotation.styleId !== style) ||
      (query &&
        !`${annotation.text} ${annotation.headings.map((heading) => heading.text).join(" ")}`
          .toLocaleLowerCase()
          .includes(query))
    )
      continue;
    let node = root;
    node.count++;
    for (const heading of annotation.headings) {
      let child = lookup.get(heading.id);
      if (!child) {
        child = { heading, annotations: [], children: [], count: 0 };
        node.children.push(child);
        lookup.set(heading.id, child);
      }
      child.count++;
      node = child;
    }
    node.annotations.push(annotation);
  }
  return root;
}
