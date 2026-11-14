import type { BlockChange, DocumentIndex } from "./model";

/** SiYuan broadcasts doOperations; undoOperations are history metadata, never replay them here. */
export function transactionChanges(
  data: unknown,
  index: DocumentIndex | undefined,
  rootId: string,
): BlockChange[] | null {
  const operations: Record<string, unknown>[] = [];
  function visit(value: unknown): boolean {
    if (Array.isArray(value)) return value.every(visit);
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.doOperations)) return visit(item.doOperations);
    if (Array.isArray(item.operations)) return visit(item.operations);
    if (typeof item.action === "string") {
      operations.push(item);
      return true;
    }
    return false;
  }
  if (!visit(data)) return null;
  const changes: BlockChange[] = [];
  const known = new Set([rootId]);
  const has = (id: string) => known.has(id) || !!index?.blocks[id];
  for (const operation of operations) {
    const id = String(operation.id ?? "");
    const parentId =
      typeof operation.parentID === "string" ? operation.parentID : undefined;
    const previousId =
      typeof operation.previousID === "string" && operation.previousID
        ? operation.previousID
        : undefined;
    const nextId =
      typeof operation.nextID === "string" && operation.nextID
        ? operation.nextID
        : undefined;
    const related =
      has(id) ||
      (parentId && has(parentId)) ||
      (previousId && has(previousId)) ||
      (nextId && has(nextId));
    if (index && !related) continue;
    const action = operation.action;
    if (action === "setDocTitle" && id === rootId) continue;
    if (
      [
        "foldHeading",
        "unfoldHeading",
        "foldBlock",
        "unfoldBlock",
        "setAttrs",
        "updateAttrs",
      ].includes(String(action))
    ) {
      // Attribute changes may affect style, heading level, or nested structure: rebuild conservatively.
      if (["setAttrs", "updateAttrs"].includes(String(action))) {
        // Document metadata (for example native viewed/updated attributes) has no inline spans or heading membership.
        if (id === rootId) continue;
        return null;
      }
      continue;
    }
    if (!["update", "insert", "delete", "move"].includes(String(action)) || !id)
      return null;
    const html =
      typeof operation.data === "string" ? operation.data : undefined;
    if ((action === "update" || action === "insert") && !html) return null;
    changes.push({
      action: action as BlockChange["action"],
      id,
      html,
      parentId,
      previousId,
      nextId,
    });
    if (action === "insert") {
      known.add(id);
      for (const match of html!.matchAll(/data-node-id="([^"]+)"/g))
        known.add(match[1]);
    }
  }
  return changes;
}
