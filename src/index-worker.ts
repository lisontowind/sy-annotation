import { t, setLocale } from "./i18n";
import { IndexEngine, type AnnotationTool, type BlockChange } from "./model";
import { QueryEngine, type QueryRequest } from "./filters";
import type { DocumentIndex } from "./model";
let engine: IndexEngine;
let snapshot: DocumentIndex | null;
let rootId = "";
let tools: AnnotationTool[] = [];
let queries: QueryEngine;
let environmentKey = "";
self.onmessage = (
  event: MessageEvent<{
    id: number;
    locale?: string;
    kind: "load" | "patch" | "tools" | "query";
    rootId: string;
    dom: string;
    changes: BlockChange[];
    tools: AnnotationTool[];
  } & QueryRequest>,
) => {
  const m = event.data;
  setLocale(m.locale);
  try {
    if (m.kind === "query") {
      if (m.rootId !== rootId || !snapshot) throw new Error(t("文档索引已切换，请重试"));
      const key = JSON.stringify(m.environment);
      if (!queries || key !== environmentKey) {
        queries = new QueryEngine(tools, m.environment);
        environmentKey = key;
      }
      self.postMessage({ id: m.id, query: { rootId, version: m.version, catalogRevision: m.catalogRevision, keys: queries.select(snapshot.annotations, m.query).map((a) => a.key) } });
      return;
    }
    if (m.kind === "load" || m.kind === "tools") {
      tools = m.tools;
      queries = new QueryEngine(tools);
      environmentKey = "";
    }
    if (m.kind === "load") rootId = m.rootId;
    const index =
      m.kind === "load"
        ? (engine = new IndexEngine(m.rootId, m.tools)).load(m.dom)
        : m.kind === "tools"
          ? engine.setTools(m.tools)
          : engine.patchIncremental(m.changes);
    if (index && "updatedBlocks" in index) {
      self.postMessage({ id: m.id, delta: index });
      return;
    }
    snapshot = index;
    self.postMessage({ id: m.id, index });
  } catch (error) {
    self.postMessage({
      id: m.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
