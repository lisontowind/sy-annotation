import { cleanText, textNodes, type Annotation, type DocumentIndex } from "./model";

export interface ReadingPosition {
  blockId: string;
  offset: number;
}

/** Use the same text offsets as the annotation index, excluding editor controls. */
export function readingPosition(node: Node, offset: number): ReadingPosition | undefined {
  const block = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
    ?.closest<HTMLElement>("[data-node-id]");
  if (!block?.dataset.nodeId) return;
  const before = block.ownerDocument.createRange();
  before.setStart(block, 0);
  before.setEnd(node, offset);
  let length = 0;
  for (const text of textNodes(block)) {
    if (before.comparePoint(text, 0) > 0) break;
    length += cleanText(text.data.slice(0, text === node ? offset : text.length)).length;
  }
  return { blockId: block.dataset.nodeId, offset: length };
}

interface Locations {
  order: string[];
  positions: Map<string, number>;
  sections: Map<string, Annotation[]>;
}
const cache = new WeakMap<Annotation[], Locations>();

/** Find the closest run in the current section, falling back through its ancestors. */
export function nearestAnnotation(index: DocumentIndex, position: ReadingPosition): Annotation | undefined {
  const block = index.blocks[position.blockId];
  if (!block) return;
  let locations = cache.get(index.annotations);
  if (!locations || locations.order !== index.order) {
    locations = { order: index.order, positions: new Map(index.order.map((id, i) => [id, i])), sections: new Map() };
    for (const annotation of index.annotations) {
      const sections = annotation.headings.length ? annotation.headings.map((h) => h.id) : [""];
      for (const section of sections) {
        let runs = locations.sections.get(section);
        if (!runs) locations.sections.set(section, runs = []);
        runs.push(annotation);
      }
    }
    cache.set(index.annotations, locations);
  }
  const section = [...block.headings].reverse().find((h) => locations.sections.has(h.id));
  const runs = locations.sections.get(section?.id ?? "");
  // Unsectioned annotations belong to the introduction, not to unrelated chapters.
  if (!runs?.length || (block.headings.length && !section)) return;
  const order = locations.positions.get(position.blockId);
  if (order === undefined) return;
  const offset = Math.max(0, position.offset);
  let low = 0, high = runs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const run = runs[middle];
    const runOrder = locations.positions.get(run.blockId)!;
    if (runOrder < order || (runOrder === order && run.end <= offset)) low = middle + 1;
    else high = middle;
  }
  const previous = runs[low - 1], next = runs[low];
  if (!previous) return next;
  if (!next) return previous;
  const previousOrder = locations.positions.get(previous.blockId)!;
  const nextOrder = locations.positions.get(next.blockId)!;
  if (previousOrder !== nextOrder) {
    // Prefer a following annotation when two blocks are equally close.
    return order - previousOrder < nextOrder - order ? previous : next;
  }
  return offset - previous.end < Math.max(0, next.start - offset) ? previous : next;
}
