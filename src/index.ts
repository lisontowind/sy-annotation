import { t, toolLabel } from "./i18n";
import {
  Plugin,
  getAllEditor,
  getActiveTab,
  openTab,
  openSetting,
  showMessage,
  type IProtyle,
} from "siyuan";
import { getDocumentDOM, getBlockDOMs } from "./api";
import {
  applyAnnotation,
  focusAnnotation,
  readSelectionStyle,
  selectedSegments,
  validateSelection,
  type EditorSelection,
} from "./editor";
import {
  loadToolConfig,
  parseAnnotations,
  applyAnnotationDelta,
  type Annotation,
  type AnnotationTool,
  type BlockChange,
  type DocumentIndex,
  type ToolConfig,
  styleSignature,
} from "./model";
import {
  AnnotationPanel,
  AnnotationToolbar,
  createEditorIndicator,
  type UIActions,
} from "./ui";
import { ToolManager } from "./tool-manager";
import { NativeColorManager } from "./native-color-manager";
import { IndexClient } from "./index-client";
import { transactionChanges } from "./changes";
import { QueryEngine, type AnnotationQuery, type QueryRequest } from "./filters";
import { appearanceOf, readColorEnvironment, visualSignature, replacementSignature, type ColorEnvironment } from "./appearance";
import { replaceBlock, replacedAppearance, snapshotBlocks, type BlockEditPlan, type ReplacementPlan, type ReplacementMode, type ProgressReporter } from "./replacement";
import { repairAppearance, repairBlock, repairCandidates, repairTools, type ColorMapping } from "./color-repair";
import { ColorRepairDialog, type ColorRepairPlan, type RepairScope } from "./color-repair-dialog";
import { ReplacementDialog } from "./replacement-dialog";
import { nearestAnnotation, readingPosition } from "./location";
import { nativeStyles, isNativeToolId, nativeUnavailableMessage } from "./native-styles";

function parseAnnotationsForVerification(html: string, tools: AnnotationTool[], environment: ColorEnvironment = readColorEnvironment()): unknown[] {
  const result: { id: string; start: number; end: number; text: string; style: string }[] = [];
  for (const a of parseAnnotations(html, tools).annotations) {
    const style = replacementSignature(appearanceOf(a), environment);
    const last = result[result.length - 1];
    if (last?.id === a.blockId && last.end === a.start && last.style === style) { last.end = a.end; last.text += a.text; }
    else result.push({ id: a.blockId, start: a.start, end: a.end, text: a.text, style });
  }
  return result;
}

export default class AnnotationPlugin extends Plugin {
  private panels = new Set<AnnotationPanel>();
  private editors = new Set<IProtyle>();
  private active?: IProtyle;
  private rootId = "";
  private savedSelection?: EditorSelection;
  private config: ToolConfig = loadToolConfig(null);
  private continuous = false;
  private singleShot = false;
  private follow = false;
  private sessionCount = 0;
  private floating?: AnnotationToolbar;
  private manager?: ToolManager;
  private topbar?: HTMLElement;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private paintTimer?: ReturnType<typeof setTimeout>;
  private locateFrame?: number;
  private requestController?: AbortController;
  private generation = 0;
  private disposed = false;
  private painting = false;
  private pendingJump?: {
    id: string;
    annotation?: Annotation;
    expires: number;
  };
  private indicators = new Map<IProtyle, HTMLElement>();
  private preferences = Promise.resolve();
  private indexer?: IndexClient;
  private index?: DocumentIndex;
  private loading = false;
  private patching = false;
  private queued: BlockChange[] = [];
  private needsRefresh = false;
  private caretBlockId = "";
  private caretOffset = 0;
  private locationSource: "caret" | "viewport" = "viewport";
  private lastCaretAt = 0;
  private replacementDialog?: ReplacementDialog;
  private replacementMode: ReplacementMode = "replace";
  private replacing = false;
  private contentVersion = 0;
  private contentKey = "";
  private documentEpoch = 0;
  private replacementContexts = new WeakMap<BlockEditPlan, { epoch: number; version: number; protyle: IProtyle; environment: ColorEnvironment; snapshot: boolean; tools: string; repair?: boolean }>();
  private repairDialog?: ColorRepairDialog;
  private toolRepairContexts = new WeakMap<ColorRepairPlan, { tools: string; environment: string }>();
  private themeObserver?: MutationObserver;
  private themeHeadObserver?: MutationObserver;
  private themeFrame?: number;
  private colorEnvironmentKey = "";
  private unsubscribeStyles?: () => void;
  private nativeColorManager?: NativeColorManager;
  private get availableTools(): AnnotationTool[] { return [...nativeStyles.tools, ...this.config.tools]; }


  private actions: UIActions = {
    chooseStyle: (id) => this.chooseTool(id),
    apply: () => this.annotateOnce(),
    toggleContinuous: () => this.setContinuous(!this.continuous),
    refresh: () => {
      void this.refresh();
    },
    navigate: (id, annotation) => this.navigate(id, annotation),
    closeToolbar: () => {
      this.setContinuous(false);
      this.floating?.destroy();
      this.floating = undefined;
    },
    showToolbar: () => this.showToolbar(),
    manageTool: (id, create) => this.openManager(id, create),
    createToolFromSelection: () => {
      this.captureSelection();
      try {
        const style = readSelectionStyle(this.savedSelection);
        this.openManager(undefined, true, style);
      } catch (error) {
        showMessage(error instanceof Error ? error.message : t("读取失败"));
      }
    },
    deleteTool: (id) => {
      void this.commitTools(
        this.config.tools.filter((tool) => tool.id !== id),
      ).catch((error) => showMessage(String(error)));
    },
    locate: () => this.locate(false),
    toggleFollow: () => {
      this.follow = !this.follow;
      for (const panel of this.panels) panel.setFollow(this.follow);
      this.locate(false);
    },
    queryAnnotations: (request) => this.queryAnnotations(request),
    openBulk: (query, annotation) => this.openBulk(query, annotation),
    getReplacementMode: () => this.replacementMode,
    setReplacementMode: (mode) => { this.replacementMode = mode; },
    replaceAnnotation: async (annotation, toolId, mode) => {
      if (this.replacing) return;
      this.replacementMode = mode;
      const controller = new AbortController();
      try {
        const plan = await this.prepareReplacement([annotation], toolId, mode, controller.signal, () => {});
        await this.commitReplacement(plan, controller.signal, () => {});
      } catch (error) { if (!this.disposed) showMessage(error instanceof Error ? error.message : t("更改失败，请重试")); }
    },
  };

  async onload(): Promise<void> {
    const [data, legacy] = await Promise.all([
      this.loadData("tools.json").catch(() => null),
      this.loadData("preferences.json").catch(() => null),
    ]);
    this.config = loadToolConfig(data, legacy);
    if (!data && !legacy?.styleId) this.config.selectedId = "native:backgroundColor:12";
    this.unsubscribeStyles = nativeStyles.subscribe(this.onNativeStyles);
    this.nativeColorManager = new NativeColorManager(() => typeof openSetting === "function" ? openSetting(this.app) : undefined,
      () => { if (!this.disposed) void nativeStyles.refresh(); });
    nativeStyles.manageColors = group => {
      void this.nativeColorManager?.open(group).catch(error => {
        if (!this.disposed && error?.name !== "AbortError") showMessage(error instanceof Error ? error.message : String(error));
      });
    };

    if (!data)
      this.persist().catch((error) => {
        console.warn("[sy-annotation] 配置迁移保存失败", error);
      });
    this.addIcons(
      '<symbol id="iconAnnotationOutline" viewBox="0 0 32 32"><path d="M6 5h20v3H6zm0 9h12v3H6zm0 9h10v3H6zm15.5 4.5-4-4L26 15l4 4z"/></symbol>',
    );
    this.addDock({
      type: "annotation-outline",
      config: {
        position: "RightTop",
        size: { width: 320, height: 0 },
        icon: "iconAnnotationOutline",
        title: t("标注大纲"),
      },
      data: {},
      init: (dock) => {
        const panel = new AnnotationPanel(this.actions);
        dock.element.append(panel.element);
        this.panels.add(panel);
        panel.setTools(this.availableTools);
        panel.setFollow(this.follow);
        panel.toolbar.update(
          this.config.selectedId,
          this.continuous,
          this.sessionCount,
          this.availableTools,
          this.singleShot,
        );
        this.setPanelDocument(panel);
        if (this.index) panel.setAnnotations(this.index.annotations);
        else if (this.rootId && !this.loading) void this.refresh();
      },
      destroy: () => {
        for (const panel of this.panels)
          if (!panel.element.isConnected) {
            panel.destroy();
            this.panels.delete(panel);
          }
      },
    });
    this.addCommand({
      langKey: "toggleToolbar",
      langText: t("显示 / 隐藏标注工具栏"),
      hotkey: "⌥⇧H",
      callback: () => this.toggleToolbar(),
    });
    this.addCommand({
      langKey: "toggleContinuous",
      langText: t("开启 / 结束连续标注"),
      hotkey: "⌥⌘H",
      callback: () => this.setContinuous(!this.continuous),
    });
    this.addCommand({
      langKey: "applyAnnotation",
      langText: t("使用当前工具标注一次"),
      hotkey: "⌥⇧M",
      callback: () => this.annotateOnce(),
    });
    for (const event of [
      "loaded-protyle-static",
      "loaded-protyle-dynamic",
      "switch-protyle",
      "switch-protyle-mode",
      "click-editorcontent",
    ] as const)
      this.eventBus.on(event, this.onEditorEvent);
    this.eventBus.on("destroy-protyle", this.onEditorDestroy);
    this.eventBus.on("ws-main", this.onTransaction);
    document.addEventListener("selectionchange", this.captureSelection);
    document.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("scroll", this.scheduleLocate, {
      capture: true,
      passive: true,
    });
    document.addEventListener("wheel", this.onViewportIntent, {
      capture: true,
      passive: true,
    });
    this.colorEnvironmentKey = JSON.stringify(readColorEnvironment());
    this.themeObserver = new MutationObserver(this.onThemeSignal);
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-mode", "data-theme", "data-light-theme", "data-dark-theme", "style", "class"] });
    this.themeHeadObserver = new MutationObserver(this.onThemeSignal);
    this.themeHeadObserver.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true });
    document.addEventListener("load", this.onThemeLoad, true);
    nativeStyles.start();
  }

  onLayoutReady(): void {
    this.topbar = this.addTopBar({
      icon: "iconAnnotationOutline",
      title: t("标注工具栏"),
      position: "right",
      callback: () => this.toggleToolbar(),
    });
    for (const editor of getAllEditor()) this.editors.add(editor.protyle);
    const model = getActiveTab()?.model as unknown as
      | { editor?: { protyle: IProtyle } }
      | undefined;
    if (model?.editor?.protyle) this.activate(model.editor.protyle);
  }

  onunload(): void {
    this.disposed = true;
    this.nativeColorManager?.destroy(); nativeStyles.manageColors = undefined;
    this.unsubscribeStyles?.(); nativeStyles.stop();
    this.themeObserver?.disconnect(); this.themeHeadObserver?.disconnect();
    document.removeEventListener("load", this.onThemeLoad, true);
    if (this.themeFrame !== undefined) cancelAnimationFrame(this.themeFrame);
    this.repairDialog?.close(true);
    this.generation++;
    this.requestController?.abort();
    this.indexer?.destroy();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.paintTimer);
    if (this.locateFrame !== undefined) cancelAnimationFrame(this.locateFrame);
    for (const event of [
      "loaded-protyle-static",
      "loaded-protyle-dynamic",
      "switch-protyle",
      "switch-protyle-mode",
      "click-editorcontent",
    ] as const)
      this.eventBus.off(event, this.onEditorEvent);
    this.eventBus.off("destroy-protyle", this.onEditorDestroy);
    this.eventBus.off("ws-main", this.onTransaction);
    document.removeEventListener("selectionchange", this.captureSelection);
    document.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("scroll", this.scheduleLocate, true);
    document.removeEventListener("wheel", this.onViewportIntent, true);
    this.floating?.destroy();
    this.manager?.close();
    this.replacementDialog?.close(true);
    this.topbar?.remove();
    for (const node of this.indicators.values()) node.remove();
    for (const editor of this.editors)
      editor.element.classList.remove("sya-painting");
    for (const panel of this.panels) panel.destroy();
    this.editors.clear();
    this.panels.clear();
    this.indicators.clear();
  }

  private persist(): Promise<void> {
    const snapshot = structuredClone(this.config);
    const save = this.preferences
      .catch(() => undefined)
      .then(async () => {
        await this.saveData("tools.json", snapshot);
      });
    this.preferences = save;
    return save;
  }
  private async commitTools(tools: AnnotationTool[]): Promise<void> {
    this.repairDialog?.stateChanged();
    const previous = this.config;
    const deletedActive = !isNativeToolId(this.config.selectedId) && !tools.some(
      (tool) => tool.id === this.config.selectedId,
    );
    this.config = {
      version: 1,
      tools: structuredClone(tools),
      selectedId: deletedActive ? (tools[0]?.id ?? "") : this.config.selectedId,
    };
    try {
      await this.persist();
    } catch (error) {
      this.config = previous;
      throw error;
    }
    if (deletedActive) this.setContinuous(false);
    for (const panel of this.panels) panel.setTools(this.availableTools);
    this.updateTools();
    const generation = this.generation;
    if (this.indexer && !this.loading) {
      try {
        const index = await this.indexer.send({
          kind: "tools",
          tools: this.availableTools,
        });
        if (generation === this.generation && index) this.publish(index);
      } catch (error) {
        this.reportError(error, generation);
      }
    }
  }
  private openManager(id?: string, create = false, initialStyle?: Pick<AnnotationTool, "marks" | "styles">): void {
    this.manager?.close();
    this.manager = new ToolManager(
      this.config.tools,
      (tools) => this.commitTools(tools),
      id,
      create,
      () => void this.openColorRepair(),
      initialStyle,
    );
  }
  private onNativeStyles = (): void => {
    if (this.disposed) return;
    if (isNativeToolId(this.config.selectedId) && !this.availableTools.some(tool => tool.id === this.config.selectedId)) this.setContinuous(false);
    // Enqueue new tool descriptors before any queries from the refreshed UI.
    const generation = this.generation;
    if (this.indexer && !this.loading) void this.indexer.send({ kind: "tools", tools: this.availableTools }).then(index => {
      if (!this.disposed && generation === this.generation && index) this.publish(index);
    }).catch(error => this.reportError(error, generation));
    for (const panel of this.panels) panel.setTools(this.availableTools);
    this.updateTools();
    this.replacementDialog?.setTools(this.availableTools, readColorEnvironment());
    this.repairDialog?.stateChanged();
    this.onThemeSignal();
  };
  private onThemeLoad = (event: Event): void => {
    if (event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet") this.onThemeSignal();
  };
  private onThemeSignal = (): void => {
    if (this.disposed || this.themeFrame !== undefined) return;
    this.themeFrame = requestAnimationFrame(() => {
      this.themeFrame = undefined;
      const environment = readColorEnvironment(), key = JSON.stringify(environment);
      if (key === this.colorEnvironmentKey) return;
      this.colorEnvironmentKey = key;
      this.updateTools();
      for (const panel of this.panels) panel.themeChanged();
      this.manager?.themeChanged();
      this.replacementDialog?.themeChanged(environment); this.repairDialog?.stateChanged();
    });
  };
  private chooseTool(id: string): void {
    if (!this.availableTools.some((tool) => tool.id === id)) {
      this.openManager(undefined, true);
      return;
    }
    this.config.selectedId = id;
    this.persist().catch(() =>
      showMessage(t("工具选择保存失败，本次仍可正常标注")),
    );
    this.updateTools();
  }
  private annotateOnce(): void {
    if (!this.availableTools.some((tool) => tool.id === this.config.selectedId)) {
      if (isNativeToolId(this.config.selectedId)) { showMessage(nativeUnavailableMessage()); return; }
      this.openManager(undefined, true);
      return;
    }
    if (!this.active || this.active.disabled || this.replacing) {
      showMessage(t("请先打开可编辑文档"));
      return;
    }
    this.captureSelection();
    this.continuous = false;
    this.singleShot = true;
    clearTimeout(this.paintTimer);
    this.updateTools();
    if (this.savedSelection) this.paint(false);
  }
  private activate(protyle: IProtyle): void {
    this.editors.add(protyle);
    this.active = protyle;
    const id = protyle.block.rootID ?? "";
    if (id !== this.rootId) {
      if (this.singleShot) { this.singleShot = false; this.updateTools(); }
      this.documentEpoch++;
      this.contentKey = "";
      this.replacementDialog?.close(true);
      this.repairDialog?.stateChanged();
      this.rootId = id;
      this.generation++;
      this.requestController?.abort();
      this.indexer?.destroy();
      this.indexer = undefined;
      this.index = undefined;
      this.loading = this.patching = this.needsRefresh = false;
      this.queued = [];
      this.savedSelection = undefined;
      this.caretBlockId = "";
      this.caretOffset = 0;
      this.locationSource = "viewport";
      clearTimeout(this.refreshTimer);
      for (const panel of this.panels) {
        this.setPanelDocument(panel);
        panel.setAnnotations([]);
      }
      if (id) void this.refresh();
    } else for (const panel of this.panels) this.setPanelDocument(panel);
    this.updateIndicators();
    this.scheduleLocate();
  }
  private onEditorEvent = (event: CustomEvent<{ protyle: IProtyle }>): void => {
    const protyle = event.detail.protyle;
    if (!protyle?.block?.rootID) return;
    this.editors.add(protyle);
    const loading = [
      "loaded-protyle-static",
      "loaded-protyle-dynamic",
    ].includes(event.type);
    if (!loading || !this.active || this.active === protyle)
      this.activate(protyle);
    else this.updateIndicators();
    this.resolvePendingJump();
  };
  private onEditorDestroy = (
    event: CustomEvent<{ protyle: IProtyle }>,
  ): void => {
    const editor = event.detail.protyle;
    this.editors.delete(editor);
    this.indicators.get(editor)?.remove();
    this.indicators.delete(editor);
    editor.element.classList.remove("sya-painting");
    if (this.savedSelection?.protyle === editor)
      this.savedSelection = undefined;
    if (this.active === editor) {
      this.active = undefined;
      if (this.singleShot) { this.singleShot = false; this.updateTools(); }
      this.rootId = "";
      this.generation++;
      this.requestController?.abort();
      this.indexer?.destroy();
      this.indexer = undefined;
      this.index = undefined;
      this.queued = [];
      this.loading = this.patching = false;
      for (const panel of this.panels) {
        this.setPanelDocument(panel);
        panel.setAnnotations([]);
      }
    }
  };
  private onTransaction = (
    event: CustomEvent<{ cmd?: string; data?: unknown }>,
  ): void => {
    if (event.detail.cmd === "reloadInlineStyles") { nativeStyles.scheduleRefresh(); return; }
    if (["setLocalStorageVal", "setLocalStorageVals", "removeLocalStorageVal", "removeLocalStorageVals"].includes(event.detail.cmd || "")) {
      queueMicrotask(() => { if (!this.disposed) this.updateTools(); });
    }
    if (!this.rootId) return;
    if (event.detail.cmd === "transactions") {
      const changes = transactionChanges(
        event.detail.data,
        this.index,
        this.rootId,
      );
      if (changes === null) {
        console.debug("[sy-annotation] 重建索引：未识别事务");
        this.scheduleRefresh();
      }
      else this.queueChanges(changes);
      for (const panel of this.panels) this.setPanelDocument(panel);
    } else if (
      ["update", "refresh", "reloadProtyle", "syncFinish"].includes(
        event.detail.cmd ?? "",
      )
    ) {
      console.debug("[sy-annotation] 重建索引：", event.detail.cmd);
      this.scheduleRefresh();
    }
    else if (event.detail.cmd === "rename")
      for (const panel of this.panels) this.setPanelDocument(panel);
  };
  private queueChanges(changes: BlockChange[]): void {
    if (!changes.length) return;
    this.queued.push(...changes);
    if (!this.loading) void this.flushChanges();
  }
  private async flushChanges(): Promise<void> {
    if (
      this.patching ||
      this.loading ||
      this.disposed ||
      !this.indexer ||
      !this.queued.length
    )
      return;
    this.patching = true;
    const generation = this.generation;
    try {
      while (
        this.queued.length &&
        generation === this.generation &&
        !this.loading
      ) {
        const changes = this.queued.splice(0);
        const index = await this.indexer.patch(changes);
        if (generation !== this.generation) return;
        if (!index) {
          console.debug("[sy-annotation] 重建索引：无法增量应用", changes.map((c) => c.action).join(","));
          this.queued = [];
          this.scheduleRefresh();
          return;
        }
        if ("updatedBlocks" in index && this.index) {
          applyAnnotationDelta(this.index, index);
          if (index.updatedBlocks.length) { this.contentVersion++; this.repairDialog?.stateChanged(); }
          if (index.annotations.length) {
            this.contentKey = "";
            for (const panel of this.panels) panel.setAnnotations(this.index.annotations, this.index.headings);
          }
        } else if (!("updatedBlocks" in index)) this.publish(index);
      }
    } catch (error) {
      this.reportError(error, generation);
      if (generation === this.generation) this.scheduleRefresh();
    } finally {
      if (generation === this.generation) this.patching = false;
    }
  }
  private captureSelection = (): void => {
    if (this.painting || this.disposed) return;
    this.scheduleLocate();
    if (document.activeElement?.matches("input, textarea, select")) {
      this.savedSelection = undefined;
      return;
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      this.savedSelection = undefined;
      return;
    }
    if (
      selection.focusNode &&
      this.active?.wysiwyg?.element.contains(selection.focusNode)
    ) {
      const position = readingPosition(selection.focusNode, selection.focusOffset);
      if (position) {
        this.caretBlockId = position.blockId;
        this.caretOffset = position.offset;
      }
      this.locationSource = "caret";
      this.lastCaretAt = performance.now();
    }
    const range = selection.getRangeAt(0);
    for (const protyle of this.editors)
      if (validateSelection(protyle, range)) {
        this.savedSelection = { protyle, range: range.cloneRange() };
        return;
      }
    this.savedSelection = undefined;
  };
  private onPointerUp = (event: PointerEvent): void => {
    if (
      !(this.continuous || this.singleShot) ||
      event.button !== 0 ||
      !(event.target instanceof Node) ||
      ![...this.editors].some((editor) =>
        editor.wysiwyg?.element.contains(event.target as Node),
      )
    )
      return;
    clearTimeout(this.paintTimer);
    this.paintTimer = setTimeout(() => {
      if ((this.continuous || this.singleShot) && !this.disposed) this.paint(true);
    }, 0);
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    if (
      (this.continuous || this.singleShot) &&
      ((event.shiftKey &&
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          "PageUp",
          "PageDown",
        ].includes(event.key)) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a"))
    ) {
      clearTimeout(this.paintTimer);
      this.paintTimer = setTimeout(() => {
        if ((this.continuous || this.singleShot) && !this.disposed) this.paint(true);
      }, 0);
    }
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    // An open picker handles Escape first, keeping its parent dialog open.
    if (event.key === "Escape" && document.querySelector("details.sya-style-picker[open]")) return;
    if (event.key === "Escape" && (this.continuous || this.singleShot)) {
      this.setContinuous(false);
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private paint(automatic: boolean): void {
    if (this.painting || this.replacing) return;
    this.captureSelection();
    const target = this.savedSelection;
    const style = this.availableTools.find(
      (tool) => tool.id === this.config.selectedId,
    );
    if (!target || !style || !validateSelection(target.protyle, target.range))
      return;
    this.painting = true;
    try {
      const blocks = [
        ...new Set(
          selectedSegments(target.protyle, target.range).map(
            (segment) => segment.block,
          ),
        ),
      ];
      if (!applyAnnotation(target, style)) return;
      if (this.continuous) this.sessionCount++;
      this.singleShot = false;
      this.savedSelection = undefined;
      window.getSelection()?.collapseToEnd();
      this.updateTools();
      if (target.protyle === this.active)
        this.queueChanges(
          blocks.map((block) => ({
            action: "update",
            id: block.dataset.nodeId!,
            html: block.outerHTML,
          })),
        );
    } catch (error) {
      console.error("[sy-annotation] 标注失败", error);
      showMessage(t("标注未完成，请重新选择文字后重试"));
      if (automatic) this.setContinuous(false);
    } finally {
      this.painting = false;
    }
  }
  private setContinuous(value: boolean): void {
    if (value && !this.availableTools.some(tool => tool.id === this.config.selectedId)) {
      if (isNativeToolId(this.config.selectedId)) { showMessage(nativeUnavailableMessage()); return; }
      this.openManager(undefined, true);
      return;
    }
    if (value && !this.continuous) this.sessionCount = 0;
    this.continuous = value;
    this.singleShot = false;
    clearTimeout(this.paintTimer);
    if (value) this.showToolbar();
    this.updateTools();
  }
  private showToolbar(): void {
    if (!this.floating) {
      this.floating = new AnnotationToolbar(this.actions, true);
      document.body.append(this.floating.element);
    }
    this.floating.update(
      this.config.selectedId,
      this.continuous,
      this.sessionCount,
      this.availableTools,
      this.singleShot,
    );
  }
  private toggleToolbar(): void {
    if (this.floating) this.actions.closeToolbar();
    else this.showToolbar();
  }
  private updateTools(): void {
    for (const panel of this.panels)
      panel.toolbar.update(
        this.config.selectedId,
        this.continuous,
        this.sessionCount,
        this.availableTools,
        this.singleShot,
      );
    this.floating?.update(
      this.config.selectedId,
      this.continuous,
      this.sessionCount,
      this.availableTools,
      this.singleShot,
    );
    this.topbar?.classList.toggle("toolbar__item--active", this.continuous || this.singleShot);
    this.updateIndicators();
  }
  private updateIndicators(): void {
    for (const [editor, node] of this.indicators) {
      node.remove();
      editor.element.classList.remove("sya-painting");
    }
    this.indicators.clear();
    if (!(this.continuous || this.singleShot)) return;
    for (const editor of this.editors)
      if (editor.element.isConnected && !editor.disabled && editor.wysiwyg) {
        const node = createEditorIndicator(
          toolLabel(this.availableTools.find((tool) => tool.id === this.config.selectedId)),
          this.sessionCount,
          () => this.setContinuous(false),
          this.singleShot,
        );
        editor.element.classList.add("sya-painting");
        editor.element.append(node);
        this.indicators.set(editor, node);
      }
  }
  private setPanelDocument(panel: AnnotationPanel): void {
    const id = this.active?.block.rootID ?? "";
    panel.element.dataset.rootId = id;
    panel.setDocument(
      id,
      id
        ? this.active?.title?.editElement?.textContent || t("未命名文档")
        : t("打开文档开始阅读"),
    );
  }
  private scheduleRefresh(): void {
    if (this.loading) {
      this.needsRefresh = true;
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 350);
  }
  private async refresh(): Promise<void> {
    if (this.disposed || !this.rootId || !this.active || !this.panels.size)
      return;
    if (this.loading) {
      this.needsRefresh = true;
      return;
    }
    clearTimeout(this.refreshTimer);
    this.generation++;
    const generation = this.generation;
    const id = this.rootId;
    this.requestController?.abort();
    this.indexer?.destroy();
    this.indexer = undefined;
    this.loading = true;
    this.patching = false;
    this.needsRefresh = false;
    this.queued = [];
    const controller = new AbortController();
    this.requestController = controller;
    const toolSnapshot = structuredClone(this.availableTools);
    for (const panel of this.panels) {
      this.setPanelDocument(panel);
      panel.setLoading();
    }
    try {
      const dom = await getDocumentDOM(
        id,
        this.active.notebookId,
        controller.signal,
      );
      if (this.disposed || generation !== this.generation) return;
      this.indexer = new IndexClient(this.name);
      let index = await this.indexer.send({
        kind: "load",
        rootId: id,
        dom,
        tools: toolSnapshot,
      });
      if (this.disposed || generation !== this.generation || !index) return;
      // Reclassify if tool settings changed while the initial document request was pending.
      if (JSON.stringify(toolSnapshot) !== JSON.stringify(this.availableTools))
        index = await this.indexer.send({
          kind: "tools",
          tools: this.availableTools,
        });
      if (generation === this.generation && index) this.publish(index);
    } catch (error) {
      if (!controller.signal.aborted) this.reportError(error, generation);
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        if (this.needsRefresh) this.scheduleRefresh();
        else void this.flushChanges();
      }
    }
  }
  private publish(index: DocumentIndex): void {
    const key = JSON.stringify([index.order, index.headings, index.annotations.map((a) => [a.blockId, a.start, a.end, a.text, a.signature, a.headings.map((h) => h.id)])]);
    if (key !== this.contentKey) { this.contentKey = key; this.contentVersion++; this.repairDialog?.stateChanged(); }
    this.index = index;
    for (const panel of this.panels) panel.setAnnotations(index.annotations, index.headings);
    this.scheduleLocate();
  }
  private queryAnnotations(request: QueryRequest) {
    if (request.catalogRevision !== undefined && request.catalogRevision !== nativeStyles.revision) return Promise.reject(new Error(t("样式库已更新，请重新查找")));
    if (request.rootId !== this.rootId) return Promise.reject(new Error(t("文档已切换")));
    if (this.indexer) return this.indexer.query(request);
    return Promise.resolve({ rootId: request.rootId, version: request.version, catalogRevision: request.catalogRevision, keys: new QueryEngine(this.availableTools, request.environment).select(this.index?.annotations ?? [], request.query).map((a) => a.key) });
  }
  private openBulk(query: AnnotationQuery, annotation?: Annotation): void {
    if (!this.index || !this.active || this.loading || this.replacing) { showMessage(t("请等待当前文档索引完成")); return; }
    this.replacementDialog?.close();
    this.replacementDialog = new ReplacementDialog(this.index.annotations, this.availableTools, readColorEnvironment(), query, this.replacementMode, annotation,
      async (spec, signal, progress) => {
        await this.flushForReplacement(signal);
        const env = readColorEnvironment();
        const engine = new QueryEngine(this.availableTools, env);
        const base = spec.scope === "filtered" ? engine.select(this.index!.annotations, spec.query) : this.index!.annotations;
        const source = { kind: "condition" as const, field: spec.sourceKind === "tool" ? "tool" as const : "signature" as const, value: spec.source, exclude: false };
        return this.prepareReplacement(base.filter((a) => engine.rule(a, source)), spec.targetId, spec.mode, signal, progress);
      },
      (plan, signal, progress) => this.commitReplacement(plan, signal, progress),
      (mode) => { this.replacementMode = mode; });
  }
  private async openColorRepair(): Promise<void> {
    if (this.replacing || this.disposed) return;
    this.manager?.close(); this.repairDialog?.close();
    const backup = await this.loadData("tools-theme-backup.json").catch(() => null);
    if (this.disposed) return;
    this.repairDialog = new ColorRepairDialog(
      scope => repairCandidates(scope === "tools" ? this.config.tools :
        !this.loading ? (this.index?.annotations || []).map(appearanceOf) : []),
      (scope, mappings, signal) => this.prepareColorRepair(scope, mappings, signal),
      async (plan, signal, progress) => {
        if (plan.scope === "document") { await this.commitReplacement(plan, signal, progress); return; }
        const context = this.toolRepairContexts.get(plan);
        const valid = () => !this.disposed && context?.tools === JSON.stringify(this.config.tools) &&
          context.environment === JSON.stringify(readColorEnvironment());
        signal.throwIfAborted();
        if (!valid() || !plan.tools) throw new Error(t("内容或工具已变化，请重新预览"));
        await this.saveData("tools-theme-backup.json", structuredClone(this.config));
        signal.throwIfAborted();
        if (!valid()) throw new Error(t("内容或工具已变化，请重新预览"));
        progress({ phase: "saving", completed: 0, total: plan.changed });
        await this.commitTools(plan.tools); this.toolRepairContexts.delete(plan);
        progress({ phase: "done", completed: plan.changed, total: plan.changed });
      },
      async () => {
        const saved = await this.loadData("tools-theme-backup.json");
        if (!saved || saved.version !== 1 || !Array.isArray(saved.tools)) throw new Error(t("工具备份无效或不存在"));
        const config = loadToolConfig(saved);
        if (config.tools.length !== saved.tools.length) throw new Error(t("工具备份无效或不存在"));
        await this.commitTools(config.tools);
      }, !!backup,
    );
  }
  private async prepareColorRepair(scope: RepairScope, mappings: ColorMapping[], signal: AbortSignal): Promise<ColorRepairPlan> {
    signal.throwIfAborted();
    const environment = readColorEnvironment();
    if (scope === "tools") {
      const source = this.config.tools, tools = repairTools(source, mappings);
      const changed = source.filter((tool, i) => styleSignature(tool.marks, tool.styles) !== styleSignature(tools[i].marks, tools[i].styles));
      const plan: ColorRepairPlan = { scope, rootId: "", blocks: [], tools, matched: changed.length, changed: changed.length,
        examples: changed.slice(0, 5).map(tool => ({
          before: { key: tool.id, blockId: "", text: toolLabel(tool), start: 0, end: toolLabel(tool).length, styleId: tool.id,
            label: tool.label, color: tool.color, signature: styleSignature(tool.marks, tool.styles), headings: [] },
          after: repairAppearance(tool, mappings),
        })) };
      this.toolRepairContexts.set(plan, { tools: JSON.stringify(source), environment: JSON.stringify(environment) }); return plan;
    }
    await this.flushForReplacement(signal);
    const protyle = this.active!, rootId = this.rootId, epoch = this.documentEpoch, version = this.contentVersion;
    const tools = JSON.stringify(this.config.tools);
    const annotations = this.index!.annotations.filter(a => {
      const before = appearanceOf(a), after = repairAppearance(before, mappings);
      return styleSignature(before.marks, before.styles) !== styleSignature(after.marks, after.styles);
    });
    const ids = [...new Set(annotations.map(a => a.blockId))];
    const plan: ColorRepairPlan = { scope, rootId, blocks: [], matched: annotations.length, changed: 0,
      examples: annotations.slice(0, 5).map(before => ({ before, after: repairAppearance(appearanceOf(before), mappings) })) };
    await this.readReplacementBlocks(ids, protyle, signal, async (_id, html) => {
      const block = repairBlock(html, mappings, this.config.tools);
      if (block.count && block.before !== block.after) plan.blocks.push(block);
    });
    signal.throwIfAborted();
    if (this.disposed || rootId !== this.rootId || epoch !== this.documentEpoch || version !== this.contentVersion ||
      tools !== JSON.stringify(this.config.tools) || JSON.stringify(environment) !== JSON.stringify(readColorEnvironment()))
      throw new Error(t("内容或工具已变化，请重新预览"));
    plan.changed = plan.blocks.reduce((n, block) => n + block.count, 0);
    this.replacementContexts.set(plan, { epoch, version, protyle, environment, snapshot: ids.length >= 32, tools, repair: true });
    return plan;
  }
  private async flushForReplacement(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const editor = this.active;
    if (!editor || editor.disabled || this.disposed) throw new Error(t("当前文档不可编辑"));
    await editor.getInstance().flushPendingTransactions?.();
    // Let native transaction broadcasts reach the incremental index before taking the snapshot.
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (let i = 0; (this.loading || this.patching || this.queued.length) && i < 300; i++) {
      signal.throwIfAborted(); await new Promise((resolve) => setTimeout(resolve, 20));
    }
    signal.throwIfAborted();
    if (editor !== this.active || !this.index || this.loading || this.patching || this.queued.length) throw new Error(t("文档尚未就绪，请重试"));
  }
  private async forReplacementBlocks<T>(items: T[], signal: AbortSignal, operation: (item: T, index: number) => Promise<void>): Promise<void> {
    let cursor = 0;
    let failed = false;
    const results = await Promise.allSettled(Array.from({ length: Math.min(8, items.length) }, async () => {
      try { while (cursor < items.length && !failed) { signal.throwIfAborted(); const i = cursor++; await operation(items[i], i); } }
      catch (error) { failed = true; throw error; }
    }));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  private async readReplacementBlocks(ids: string[], protyle: IProtyle, signal: AbortSignal, operation: (id: string, html: string, index: number) => Promise<void>, forceSnapshot = false): Promise<void> {
    // getBlockDOMs reloads the source tree for every ID. Large jobs need just one
    // authoritative document snapshot per phase, without mounting it in the editor.
    if (forceSnapshot || ids.length >= 32) {
      const rootId = protyle.block.rootID!;
      const html = await getDocumentDOM(rootId, protyle.notebookId, signal);
      signal.throwIfAborted();
      const snapshots = snapshotBlocks(html, ids);
      for (let i = 0; i < ids.length; i++) {
        signal.throwIfAborted(); await operation(ids[i], snapshots.get(ids[i])!, i);
        if (i % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return;
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 64) chunks.push(ids.slice(i, i + 64));
    await this.forReplacementBlocks(chunks, signal, async (chunk, index) => {
      const snapshots = await getBlockDOMs(chunk, protyle.notebookId, signal);
      for (let i = 0; i < chunk.length; i++) {
        signal.throwIfAborted(); await operation(chunk[i], snapshots[chunk[i]], index * 64 + i);
        if (i % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }
  private async prepareReplacement(annotations: Annotation[], toolId: string, mode: ReplacementMode, signal: AbortSignal, progress: ProgressReporter): Promise<ReplacementPlan> {
    progress({ phase: "preparing", completed: 0, total: annotations.length, message: t("正在读取原文并准备预览") });
    await this.flushForReplacement(signal);
    const protyle = this.active!; const rootId = this.rootId; const epoch = this.documentEpoch; const version = this.contentVersion;
    const target = this.availableTools.find((t) => t.id === toolId);
    if (!target) throw new Error(t("目标工具已不存在"));
    const environment = readColorEnvironment();
    const plan: ReplacementPlan = { rootId, target: structuredClone(target), mode, blocks: [], matched: annotations.length, changed: 0, examples: [] };
    const groups = new Map<string, Annotation[]>();
    for (const a of annotations) { const list = groups.get(a.blockId) ?? []; list.push(a); groups.set(a.blockId, list); }
    const entries = [...groups]; let done = 0;
    const results: ReplacementPlan["blocks"] = new Array(entries.length);
    await this.readReplacementBlocks(entries.map(([id]) => id), protyle, signal, async (id, html, i) => {
      if (this.rootId !== rootId || epoch !== this.documentEpoch) throw new Error(t("文档已切换"));
      const annotations = entries[i][1];
      results[i] = replaceBlock(html, annotations, target, mode, environment, this.availableTools);
      done += annotations.length;
      progress({ phase: "preparing", completed: done, total: plan.matched });
    });
    signal.throwIfAborted();
    if (this.loading || this.patching) await this.flushForReplacement(signal);
    if (this.disposed || rootId !== this.rootId || epoch !== this.documentEpoch || version !== this.contentVersion || JSON.stringify(target) !== JSON.stringify(this.availableTools.find((t) => t.id === toolId))) throw new Error(t("内容或工具已变化，请重新预览"));
    plan.blocks = results.filter((b) => b.count > 0); plan.changed = plan.blocks.reduce((sum, b) => sum + b.count, 0);
    plan.examples = annotations.filter((a) => replacementSignature(appearanceOf(a), environment) !== replacementSignature(replacedAppearance(appearanceOf(a), target, mode), environment)).slice(0, 5).map((before) => ({ before, after: replacedAppearance(appearanceOf(before), target, mode) }));
    this.replacementContexts.set(plan, { epoch, version, protyle, environment, snapshot: entries.length >= 32, tools: JSON.stringify(this.config.tools) });
    return plan;
  }
  private async commitReplacement(plan: BlockEditPlan, signal: AbortSignal, progress: ProgressReporter): Promise<void> {
    if (this.replacing) throw new Error(t("正在修改，请稍候"));
    const context = this.replacementContexts.get(plan);
    const valid = () => {
      if (!context) return false;
      const reasons = { disposed: this.disposed, document: plan.rootId !== this.rootId || context.protyle !== this.active || context.epoch !== this.documentEpoch, content: context.version !== this.contentVersion, tool: context.tools !== JSON.stringify(this.config.tools), theme: JSON.stringify(context.environment) !== JSON.stringify(readColorEnvironment()) };
      if (Object.values(reasons).some(Boolean)) { console.debug("[sy-annotation] 替换预览已失效", reasons); return false; }
      return true;
    };
    if (!valid()) throw new Error(t("内容或工具已变化，请重新预览"));
    if (!plan.changed) return;
    this.replacing = true;
    const editorStates = [...this.editors].filter((e) => e.block.rootID === plan.rootId).map((e) => ({ element: e.element, inert: e.element.inert }));
    try {
      progress({ phase: "validating", completed: 0, total: plan.changed, message: t("正在校验原文，尚未写入") });
      await this.flushForReplacement(signal);
      if (!valid()) throw new Error(t("内容已变化，请重新预览"));
      editorStates.forEach(({ element }) => { element.inert = true; });
      let done = 0;
      await this.readReplacementBlocks(plan.blocks.map((b) => b.id), context!.protyle, signal, async (_id, fresh, i) => {
        const block = plan.blocks[i];
        if (fresh !== block.before) throw new Error(t("原文已变化，请重新预览"));
        done += block.count;
        progress({ phase: "validating", completed: done, total: plan.changed });
      }, context!.snapshot);
      signal.throwIfAborted();
      if (this.loading || this.patching) await this.flushForReplacement(signal);
      if (!valid()) throw new Error(t("文档已变化，请重新预览"));
      const instance = context!.protyle.getInstance();
      if (!instance.transaction) throw new Error(t("当前思源版本不支持批量样式事务"));
      progress({ phase: "saving", completed: 0, total: plan.changed }); this.savedSelection = undefined;
      // Explicit old/new block pairs include unloaded blocks and form one native undo entry.
      instance.transaction(plan.blocks.map((b) => ({ action: "update", id: b.id, data: b.after })), plan.blocks.map((b) => ({ action: "update", id: b.id, data: b.before })));
      await instance.flushPendingTransactions?.();
      progress({ phase: "verifying", completed: 0, total: plan.changed });
      let verified = 0;
      const persisted: { id: string; html: string }[] = [];
      const verificationTools = structuredClone(this.config.tools);
      const verificationEnvironment = context!.repair ? {} : context!.environment;
      await this.readReplacementBlocks(plan.blocks.map((b) => b.id), context!.protyle, new AbortController().signal, async (id, html, i) => {
        const block = plan.blocks[i];
        const expected = parseAnnotationsForVerification(block.after, verificationTools, verificationEnvironment);
        const actual = parseAnnotationsForVerification(html, verificationTools, verificationEnvironment);
        if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(t("保存结果未确认，请检查原文后重试"));
        persisted.push({ id, html });
        verified += block.count;
        progress({ phase: "verifying", completed: verified, total: plan.changed });
      }, context!.snapshot);
      if (!this.disposed && this.rootId === plan.rootId) this.queueChanges(persisted.map(({ id, html }) => ({ action: "update", id, html })));
      this.replacementContexts.delete(plan);
      progress({ phase: "done", completed: plan.changed, total: plan.changed });
      showMessage(t("已修改 {0} 处标注，可在正文中一次撤销", plan.changed));
    } finally { editorStates.forEach(({ element, inert }) => { element.inert = inert; }); this.replacing = false; }
  }
  private reportError(error: unknown, generation: number): void {
    if (
      this.disposed ||
      generation !== this.generation ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      return;
    for (const panel of this.panels)
      panel.setError(
        error instanceof Error ? error.message : t("读取失败，请重试"),
      );
  }
  private scheduleLocate = (event?: Event): void => {
    if (this.disposed || !this.active) return;
    if (
      event?.type === "scroll" &&
      event.target instanceof Node &&
      !this.active.element.contains(event.target)
    )
      return;
    if (event?.type === "scroll" && performance.now() - this.lastCaretAt > 250)
      this.locationSource = "viewport";
    if (!this.follow) return;
    if (this.locateFrame !== undefined) return;
    this.locateFrame = requestAnimationFrame(() => {
      this.locateFrame = undefined;
      this.locate(true);
    });
  };
  private onViewportIntent = (event: WheelEvent): void => {
    if (
      event.target instanceof Node &&
      this.active?.element.contains(event.target)
    ) {
      this.locationSource = "viewport";
      this.lastCaretAt = 0;
      this.scheduleLocate();
    }
  };
  private locate(
    quiet: boolean,
    preferViewport = this.locationSource === "viewport",
  ): void {
    const editor = this.active;
    if (!editor || !this.index) {
      if (!quiet) showMessage(t("请先打开文档并等待标注索引完成"));
      return;
    }
    let position: ReturnType<typeof readingPosition>;
    const selection = window.getSelection();
    if (
      !preferViewport &&
      selection?.focusNode &&
      editor.wysiwyg?.element.contains(selection.focusNode)
    ) position = readingPosition(selection.focusNode, selection.focusOffset);
    if (position) {
      this.caretBlockId = position.blockId;
      this.caretOffset = position.offset;
    }
    if (!position && !preferViewport && this.index.blocks[this.caretBlockId])
      position = { blockId: this.caretBlockId, offset: this.caretOffset };
    if (!position) {
      const viewport = editor.contentElement ?? editor.element;
      const bounds = viewport.getBoundingClientRect();
      const top = bounds.top + Math.min(50, bounds.height / 4);
      const candidates =
        editor.wysiwyg?.element.querySelectorAll<HTMLElement>(
          "[data-node-id]",
        ) ?? [];
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (
          rect.height &&
          rect.bottom > top &&
          rect.top < bounds.bottom
        ) {
          // Containers have no own editable text; inspect their leaf blocks instead.
          const content = candidate.querySelector<HTMLElement>('[contenteditable="true"]');
          if (!content || content.closest("[data-node-id]") !== candidate) continue;
          const contentBounds = content.getBoundingClientRect();
          const point = document.caretRangeFromPoint?.(
            Math.max(bounds.left + 1, contentBounds.left + 1),
            Math.max(top, contentBounds.top + 1),
          );
          const atPoint = point ? readingPosition(point.startContainer, point.startOffset) : undefined;
          position = atPoint?.blockId === candidate.dataset.nodeId
            ? atPoint : { blockId: candidate.dataset.nodeId!, offset: 0 };
          break;
        }
      }
    }
    const annotation = position ? nearestAnnotation(this.index, position) : undefined;
    const insideAnnotation = !!(annotation && position && annotation.blockId === position.blockId &&
      position.offset >= annotation.start && position.offset < annotation.end);
    for (const panel of this.panels) {
      const result = panel.locate(annotation?.headings ?? [], quiet, annotation, insideAnnotation);
      if (!quiet && result !== "located")
        showMessage(
          result === "filtered"
            ? t("当前位置附近的标注被搜索或样式筛选隐藏，请先清除筛选")
            : t("当前章节及其祖先标题下没有可定位的标注"),
        );
    }
  }
  private navigate(id: string, annotation?: Annotation): void {
    const block = this.active?.wysiwyg?.element.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(id)}"]`,
    );
    if (block && block.getClientRects().length) {
      focusAnnotation(block, annotation);
      return;
    }
    this.pendingJump = { id, annotation, expires: Date.now() + 6000 };
    openTab({
      app: this.app,
      doc: { id, action: ["cb-get-hl", "cb-get-focus"], zoomIn: false },
    });
    this.resolvePendingJump();
  }
  private resolvePendingJump(): void {
    const pending = this.pendingJump;
    if (!pending) return;
    if (Date.now() > pending.expires) {
      this.pendingJump = undefined;
      return;
    }
    const block = this.active?.wysiwyg?.element.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(pending.id)}"]`,
    );
    if (block?.getClientRects().length) {
      this.pendingJump = undefined;
      focusAnnotation(block, pending.annotation);
    }
  }
}
