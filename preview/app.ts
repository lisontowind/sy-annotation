import AnnotationPlugin from "../src/index";
import { bus, setEditor, type Plugin } from "./mock-siyuan";
import type { IProtyle } from "siyuan";
import { setLocale, getLocale } from "../src/i18n";
import { emptyNativeStyles, type NativeStyleData } from "../src/native-styles";

setLocale(new URLSearchParams(location.search).get("lang") ?? "zh-CN");
document.documentElement.lang = getLocale();
document.documentElement.dataset.theme = "light";
if (getLocale() === "en-US") {
  document.title = "Annotation Outline · Interactive preview";
  document.querySelector(".preview-brand")!.innerHTML = '<span class="preview-brand__icon">Si</span> Annotation Outline <span class="preview-tag">Plugin demo</span>';
  document.querySelector("#theme-toggle")!.textContent = "Switch light / dark";
  document.querySelector(".preview-breadcrumb")!.textContent = "Reading notes / Learning / Turn reading into your own knowledge";
  document.querySelector(".preview-kicker")!.textContent = "READING NOTES · Ideas and reflection";
  document.querySelector("#document-title")!.textContent = "Turn reading into your own knowledge";
  document.querySelector(".preview-meta")!.textContent = "Reading notes · 5 minute read · Leave a trace of your thinking";
  document.querySelector(".preview-footer")!.textContent = "Demo host: real plugin UI and handlers; SiYuan editor and kernel APIs are simulated locally.";
  const text = [
    'Reading is a conversation with the author. <span data-type="mark">Real reading connects new ideas with what you already know.</span>',
    '01 Start with active thinking',
    'Finishing a book does not mean understanding it. <span data-type="text" style="background-color:var(--b3-font-background12)">Enter the text with a question, rather than chasing reading speed.</span>',
    'Ask a question before you read',
    'What problem does this book explore? How does it relate to your own experience? <span data-type="text" style="background-color:var(--b3-font-background4)">A question connects scattered information into a meaningful whole.</span>',
    'Use this passage to try continuous annotation. Select a sentence, switch the color, then mark another idea.',
    'Leave a mark on what matters',
    'You do not need to mark everything. <span data-type="u">Mark the words that make you pause and think.</span> A useful highlight starts a new connection or a new question.',
    '02 Give knowledge a structure',
    'Scattered highlights are only a beginning. <span data-type="text" style="background-color:var(--b3-font-background3)">Revisit the heading structure to see how ideas connect.</span>',
    'Explain it in your own words',
    '<span data-type="text" style="background-color:var(--b3-font-background9)">Explaining an idea clearly is the beginning of understanding.</span> Close the book and describe what you learned in your own words.',
  ];
  document.querySelectorAll("#wysiwyg > [data-node-id] > [contenteditable]").forEach((el, i) => { el.innerHTML = text[i]; });
}

const editor = document.querySelector<HTMLElement>("#preview-editor")!;
const wysiwyg = document.querySelector<HTMLDivElement>("#wysiwyg")!;
const title = document.querySelector<HTMLElement>("#document-title")!;
let transactionCount = 0;
let fullReads = 0;
let blockReadBatches = 0;
const history: { before: string; after: string; ids: string[] }[] = [];
let historyPosition = 0;
let virtualSource: HTMLDivElement | undefined;
const sourceElement = () => virtualSource ?? wysiwyg;
const replaceSource = (html: string) => {
  if (!virtualSource) { wysiwyg.innerHTML = html; return; }
  virtualSource.innerHTML = html;
  for (const current of [...wysiwyg.querySelectorAll<HTMLElement>("[data-node-id]")]) {
    const fresh = virtualSource.querySelector(`[data-node-id="${CSS.escape(current.dataset.nodeId!)}"]`);
    if (fresh) current.outerHTML = fresh.outerHTML;
  }
};
const protyle = {
  id: "preview",
  element: editor,
  disabled: false,
  block: { rootID: "20261113090000-preview" },
  title: { editElement: title },
  wysiwyg: { element: wysiwyg },
  getInstance: () => ({
    async flushPendingTransactions() {},
    transaction(operations: { id: string; data: string }[]) {
      const before = sourceElement().innerHTML;
      for (const operation of operations) {
        const block = sourceElement().querySelector(`[data-node-id="${CSS.escape(operation.id)}"]`);
        if (block) block.outerHTML = operation.data;
        if (virtualSource) {
          const live = wysiwyg.querySelector(`[data-node-id="${CSS.escape(operation.id)}"]`);
          if (live) live.outerHTML = operation.data;
        }
      }
      const after = sourceElement().innerHTML;
      if (before === after) return;
      history.splice(historyPosition); history.push({ before, after, ids: operations.map((o) => o.id) }); historyPosition++; transactionCount++;
      setTimeout(() => bus.emit("ws-main", { cmd: "transactions", data: [{ doOperations: operations.map((o) => ({ action: "update", ...o })) }] }), 20);
    },
    updateBatchTransaction(
      blocks: HTMLElement[],
      callback: (block: HTMLElement) => void,
    ) {
      const before = wysiwyg.innerHTML;
      blocks.forEach(callback);
      const after = wysiwyg.innerHTML;
      if (before === after) return;
      const ids = blocks.map((block) => block.dataset.nodeId!);
      history.splice(historyPosition);
      history.push({ before, after, ids });
      historyPosition++;
      transactionCount++;
      setTimeout(
        () =>
          bus.emit("ws-main", {
            cmd: "transactions",
            data: [
              {
                doOperations: blocks.map((block) => ({
                  action: "update",
                  id: block.dataset.nodeId,
                  data: block.outerHTML,
                })),
              },
            ],
          }),
        20,
      );
    },
  }),
  toolbar: {
    element: document.createElement("div"),
    range: document.createRange(),
    setInlineMark(
      _protyle: unknown,
      type: string,
      _action: string,
      text?: { type?: string; color: string },
    ) {
      const range = protyle.toolbar!.range;
      const startBlock =
        range.startContainer.parentElement?.closest("[data-node-id]");
      const endBlock =
        range.endContainer.parentElement?.closest("[data-node-id]");
      if (startBlock !== endBlock)
        throw new Error(
          "预览的编辑器模拟仅支持单块；实际插件由思源处理跨块标注。",
        );
      if (type === "text" && text?.type && ["style1", "color", "backgroundColor"].includes(text.type) && !text.color.replaceAll("\u200b", "")) {
        const properties = text.type === "color" ? ["color"] : text.type === "backgroundColor" ? ["background-color"] : ["color", "background-color"];
        const selected: Text[] = [];
        type Piece = { node: Node; selected: boolean };
        const visit = (node: Node): Piece[] => {
          if (node.nodeType === Node.TEXT_NODE) {
            const value = node.textContent || "";
            if (!range.intersectsNode(node)) return [{ node: node.cloneNode(true), selected: false }];
            const start = range.startContainer === node ? range.startOffset : 0;
            const end = range.endContainer === node ? range.endOffset : value.length;
            const result: Piece[] = [];
            if (start) result.push({ node: document.createTextNode(value.slice(0, start)), selected: false });
            if (end > start) { const text = document.createTextNode(value.slice(start, end)); selected.push(text); result.push({ node: text, selected: true }); }
            if (end < value.length) result.push({ node: document.createTextNode(value.slice(end)), selected: false });
            return result;
          }
          if (!(node instanceof HTMLElement)) return [{ node: node.cloneNode(true), selected: false }];
          const pieces = [...node.childNodes].flatMap(visit);
          if (node === startBlock || node.hasAttribute("contenteditable")) {
            const clone = node.cloneNode(false); pieces.forEach(piece => clone.appendChild(piece.node)); return [{ node: clone, selected: false }];
          }
          const result: Piece[] = [];
          for (const piece of pieces) {
            let group = result[result.length - 1];
            if (!group || group.selected !== piece.selected) {
              const clone = node.cloneNode(false) as HTMLElement;
              if (piece.selected) for (const property of properties) clone.style.removeProperty(property);
              if (!clone.style.length) { clone.removeAttribute("style"); clone.dataset.type = (clone.dataset.type || "").split(" ").filter(type => type && type !== "text").join(" "); }
              group = { node: clone, selected: piece.selected }; result.push(group);
            }
            group.node.appendChild(piece.node);
          }
          return result.length ? result : [{ node: node.cloneNode(true), selected: false }];
        };
        const block = startBlock as HTMLElement;
        const clone = visit(block)[0].node;
        protyle.getInstance().updateBatchTransaction([block], current => current.replaceChildren(...clone.childNodes));
        range.setStart(selected[0], 0); range.setEnd(selected[selected.length - 1], selected[selected.length - 1].length);
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
        return selected;
      }
      const span = document.createElement("span");
      span.dataset.type = type;
      if (text) span.style.backgroundColor = text.color;
      span.append(range.extractContents());
      range.insertNode(span);
      range.selectNodeContents(span);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      transactionCount++;
      setTimeout(() => bus.emit("ws-main", { cmd: "transactions" }), 20);
      return [span];
    },
  },
} as unknown as IProtyle;
setEditor(protyle);
let nativeStyleData: NativeStyleData = JSON.parse(localStorage.getItem("preview-native-styles") || "null") || emptyNativeStyles();
Object.assign(window, { siyuan: { config: { lang: getLocale(), appearance: { mode: 0 } }, storage: { "local-fontstyles": ["style1\u200bvar(--b3-font-background3)\u200b#214b76", "backgroundColor\u200bvar(--b3-font-background4)"] } } });
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (input === "/api/storage/getInlineStyles") return new Response(JSON.stringify({ code: 0, data: nativeStyleData }), { headers: { "Content-Type": "application/json" } });
  if (input === "/api/block/getBlockDOMs") {
    blockReadBatches++;
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ code: 0, data: Object.fromEntries(body.ids.map((id: string) => [id, sourceElement().querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.outerHTML])) }), { headers: { "Content-Type": "application/json" } });
  }
  if (input === "/api/block/getBlockDOM") {
    const body = JSON.parse(String(init?.body));
    if (body.id === protyle.block.rootID) fullReads++;
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          dom:
            body.id === protyle.block.rootID
              ? sourceElement().innerHTML
              : (sourceElement().querySelector(
                  `[data-node-id="${CSS.escape(body.id)}"]`,
                )?.outerHTML ?? ""),
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (input === "/api/storage/getLocalStorageVal")
    return new Response(
      JSON.stringify({
        code: 0,
        data: [
          "style1\u200bvar(--b3-font-background3)\u200b#214b76",
          "backgroundColor\u200bvar(--b3-font-background4)",
        ],
      }),
    );
  return nativeFetch(input, init);
};
const plugin = new AnnotationPlugin({
  app: {} as never,
  name: "sy-annotation",
  displayName: "标注大纲",
  i18n: {},
});
await plugin.onload();
plugin.onLayoutReady();
document.querySelector("#theme-toggle")!.addEventListener("click", () => {
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
wysiwyg.addEventListener("click", () =>
  bus.emit("click-editorcontent", { protyle }),
);
wysiwyg.addEventListener("input", (event) => {
  const block = (event.target as Element)?.closest("[data-node-id]");
  if (block)
    bus.emit("ws-main", {
      cmd: "transactions",
      data: [
        {
          doOperations: [
            {
              action: "update",
              id: block.getAttribute("data-node-id"),
              data: block.outerHTML,
            },
          ],
        },
      ],
    });
});
document.addEventListener("keydown", (event) => {
  const commands = (plugin as unknown as Plugin).commands;
  if (
    (event.ctrlKey || event.metaKey) &&
    event.altKey &&
    event.code === "KeyH"
  ) {
    event.preventDefault();
    commands
      .find((command) => command.langKey === "toggleContinuous")
      ?.callback();
  } else if (event.altKey && event.shiftKey && event.code === "KeyH") {
    event.preventDefault();
    commands.find((command) => command.langKey === "toggleToolbar")?.callback();
  }
});
function historyStep(redo: boolean) {
  const item = history[redo ? historyPosition : historyPosition - 1];
  if (!item) return;
  historyPosition += redo ? 1 : -1;
  replaceSource(redo ? item.after : item.before);
  bus.emit("ws-main", {
    cmd: "transactions",
    data: [
      {
        doOperations: item.ids.map((id) => ({
          action: "update",
          id,
          data: sourceElement().querySelector(`[data-node-id="${id}"]`)!.outerHTML,
        })),
      },
    ],
  });
}
Object.assign(window, {
  annotationPreview: {
    plugin,
    setNativeStyles(data: NativeStyleData, broadcast = true) {
      nativeStyleData = structuredClone(data); localStorage.setItem("preview-native-styles", JSON.stringify(data));
      let node = document.getElementById("siyuanStyle");
      if (!node) { node = document.createElement("style"); node.id = "siyuanStyle"; document.head.append(node); }
      node.textContent = (["light", "dark"] as const).map(mode => {
        const declarations: string[] = [];
        for (const style of data.styles) for (const property of ["color", "backgroundColor"] as const)
          if (style[mode][property]) declarations.push(`--b3-inline-style-${style.id}-${property === "color" ? "color" : "background-color"}:${style[mode][property]}`);
        for (const color of data.builtin.colors) for (const property of ["color", "backgroundColor"] as const)
          if (color[mode][property]) declarations.push(`--b3-font-${property === "color" ? "color" : "background"}${color.index}:${color[mode][property]}`);
        const content: string[] = [];
        for (const style of data.builtin.styles) for (const property of ["color", "backgroundColor"] as const)
          if (style[mode][property]) content.push(`--b3-card-${style.id}-${property === "color" ? "color" : "background"}:${style[mode][property]}`);
        return `:root[data-theme="${mode}"] {${declarations.join(";")}} :root[data-theme="${mode}"] .protyle-wysiwyg {${content.join(";")}}`;
      }).join("\n");
      if (broadcast) bus.emit("ws-main", { cmd: "reloadInlineStyles" });
    },
    protyle,
    bus,
    undo: () => historyStep(false),
    redo: () => historyStep(true),
    setVirtualDocument(html: string) {
      virtualSource = document.createElement("div"); virtualSource.innerHTML = html;
      wysiwyg.innerHTML = [...virtualSource.children].slice(0, 12).map((node) => node.outerHTML).join("");
      bus.emit("ws-main", { cmd: "refresh" });
    },
    get sourceDOM() { return sourceElement().innerHTML; },
    get transactions() {
      return transactionCount;
    },
    get fullReads() {
      return fullReads;
    },
    get blockReadBatches() { return blockReadBatches; },
  },
});
// Reproduce native host styles when the preview frontend is reloaded.
if (nativeStyleData.styles.length || nativeStyleData.builtin.colors.length || nativeStyleData.builtin.styles.length)
  (window as any).annotationPreview.setNativeStyles(nativeStyleData, false);
