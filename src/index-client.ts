import { t, getLocale } from "./i18n";
import type { AnnotationTool, BlockChange, DocumentIndex, AnnotationDelta } from "./model";
import type { QueryRequest, QueryResult } from "./filters";
export class IndexClient {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >();
  constructor(pluginName: string) {
    this.worker = new Worker(
      `/plugins/${encodeURIComponent(pluginName)}/index-worker.js`,
    );
    this.worker.onmessage = (event) => {
      const { id, index, delta, query, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(query ?? delta ?? index);
    };
    this.worker.onerror = () => {
      for (const item of this.pending.values())
        item.reject(new Error(t("标注索引线程出错，请刷新重试")));
      this.pending.clear();
    };
  }
  send(
    message:
      | { kind: "load"; rootId: string; dom: string; tools: AnnotationTool[] }
      | { kind: "tools"; tools: AnnotationTool[] },
  ): Promise<DocumentIndex | null> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id, locale: getLocale() });
    });
  }
  patch(changes: BlockChange[]): Promise<DocumentIndex | AnnotationDelta | null> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ kind: "patch", changes, id, locale: getLocale() });
    });
  }
  query(request: QueryRequest): Promise<QueryResult> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ kind: "query", id, ...request, locale: getLocale() });
    });
  }
  destroy(): void {
    this.worker.terminate();
    for (const pending of this.pending.values())
      pending.reject(new DOMException(t("索引任务已取消"), "AbortError"));
    this.pending.clear();
  }
}
