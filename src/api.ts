import { t } from "./i18n";
export async function request<T>(
  path: string,
  body: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(t("请求失败（{0}）", response.status));
  const result = (await response.json()) as {
    code: number;
    msg: string;
    data: T;
  };
  if (result.code !== 0) throw new Error(result.msg || t("思源接口返回错误"));
  return result.data;
}

export async function getDocumentDOM(
  id: string,
  notebook: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const result = await request<{ dom: string }>(
    "/api/block/getBlockDOM",
    { id, ...(notebook ? { notebook } : {}) },
    signal,
  );
  if (typeof result?.dom !== "string")
    throw new Error(t("文档内容暂不可用，请确认文档仍然存在且已解锁"));
  return result.dom;
}

/** Read only the affected blocks, in bounded batches, including unloaded editor content. */
export async function getBlockDOMs(ids: string[], notebook: string | undefined, signal?: AbortSignal): Promise<Record<string, string>> {
  try {
    const result = await request<Record<string, string>>("/api/block/getBlockDOMs", { ids, ...(notebook ? { notebook } : {}) }, signal);
    if (!result || ids.some((id) => typeof result[id] !== "string")) throw new Error(t("部分原文块不存在或不可读取，请刷新后重试"));
    return result;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("404")) throw error;
    const results = await Promise.allSettled(ids.map(async (id) => [id, await getDocumentDOM(id, notebook, signal)] as const));
    const entries: [string, string][] = [];
    for (const result of results) { if (result.status === "rejected") throw result.reason; entries.push([...result.value]); }
    return Object.fromEntries(entries);
  }
}
