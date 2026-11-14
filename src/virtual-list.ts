export interface VirtualRow {
  key: string;
  estimate: number;
  version?: unknown;
  render(): HTMLElement;
}

/** Variable-height list with stable scroll anchors and bounded DOM (visible rows + 8 each side). */
export class VirtualList {
  private rows: VirtualRow[] = [];
  private sizes = new Map<string, number>();
  private offsets = [0];
  private observer?: ResizeObserver;
  private viewportObserver?: ResizeObserver;
  private frame?: number;
  private top = document.createElement("div");
  private body = document.createElement("div");
  private bottom = document.createElement("div");
  private mounted = new Map<string, HTMLElement>();
  private versions = new Map<string, unknown>();
  private indices = new Map<string, number>();
  private dirty = false;
  private start = -1;
  private end = -1;
  private viewportWidth = 0;
  constructor(readonly viewport: HTMLElement) {
    this.top.className = this.bottom.className = "sya-virtual-spacer";
    this.top.setAttribute("aria-hidden", "true");
    this.bottom.setAttribute("aria-hidden", "true");
    this.body.className = "sya-virtual-body";
    viewport.append(this.top, this.body, this.bottom);
    viewport.addEventListener("scroll", this.schedule, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver((entries) => {
        const anchor = this.anchor();
        let changed = false;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.key!;
          if (this.mounted.get(key) !== entry.target) continue;
          const height =
            entry.borderBoxSize?.[0]?.blockSize ??
            entry.target.getBoundingClientRect().height;
          if (
            height > 0 &&
            Math.abs((this.sizes.get(key) ?? 0) - height) > 0.5
          ) {
            this.sizes.set(key, height);
            changed = true;
          }
        }
        if (changed) {
          this.rebuildOffsets();
          this.restore(anchor);
          this.draw();
        }
      });
      this.viewportObserver = new ResizeObserver(() => {
        const width = viewport.clientWidth;
        if (width !== this.viewportWidth) {
          this.viewportWidth = width;
          this.sizes.clear();
          this.rebuildOffsets();
        }
        this.draw();
      });
      this.viewportObserver.observe(viewport);
    }
  }
  setRows(rows: VirtualRow[], reset = false): void {
    const anchor = this.anchor();
    const layoutChanged = rows.length !== this.rows.length || rows.some((row, i) => row.key !== this.rows[i].key || row.estimate !== this.rows[i].estimate);
    this.rows = rows;
    if (layoutChanged) {
      this.indices = new Map(rows.map((row, i) => [row.key, i]));
      for (const key of this.sizes.keys()) if (!this.indices.has(key)) this.sizes.delete(key);
      this.rebuildOffsets();
    }
    if (reset) this.viewport.scrollTop = 0;
    else this.restore(anchor);
    this.dirty = true;
    this.draw();
  }
  scrollToKey(key: string): boolean {
    const index = this.indices.get(key);
    if (index === undefined) return false;
    this.viewport.scrollTop = this.offsets[index];
    this.draw();
    return true;
  }
  private rebuildOffsets(): void {
    this.offsets = [0];
    for (const row of this.rows)
      this.offsets.push(
        this.offsets[this.offsets.length - 1] +
          (this.sizes.get(row.key) ?? row.estimate),
      );
  }
  private lowerBound(offset: number): number {
    let low = 0,
      high = this.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.offsets[middle + 1] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, Math.max(0, this.rows.length - 1));
  }
  private anchor(): { key?: string; offset: number; index: number } {
    const index = this.lowerBound(this.viewport.scrollTop);
    return {
      key: this.rows[index]?.key,
      offset: this.viewport.scrollTop - this.offsets[index],
      index,
    };
  }
  private restore(anchor: {
    key?: string;
    offset: number;
    index: number;
  }): void {
    let index = anchor.key
      ? (this.indices.get(anchor.key) ?? -1)
      : 0;
    if (index < 0) index = Math.min(anchor.index, this.rows.length - 1);
    this.viewport.scrollTop = Math.max(
      0,
      (this.offsets[index] ?? 0) + anchor.offset,
    );
  }
  private schedule = (): void => {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.draw();
    });
  };
  private draw(): void {
    const height = this.viewport.clientHeight || 600;
    const start = Math.max(0, this.lowerBound(this.viewport.scrollTop) - 8);
    const end = this.rows.length
      ? Math.min(
          this.rows.length,
          this.lowerBound(this.viewport.scrollTop + height) + 9,
        )
      : 0;
    this.top.style.height = `${this.offsets[start] ?? 0}px`;
    this.bottom.style.height = `${Math.max(0, this.offsets[this.rows.length] - (this.offsets[end] ?? 0))}px`;
    if (!this.dirty && start === this.start && end === this.end) return;
    this.dirty = false;
    this.start = start;
    this.end = end;
    const wanted = new Set(this.rows.slice(start, end).map((row) => row.key));
    for (const [key, node] of this.mounted) if (!wanted.has(key)) {
      this.observer?.unobserve(node); node.remove(); this.versions.delete(key);
    }
    const next = new Map<string, HTMLElement>();
    let cursor = this.body.firstChild;
    for (let i = start; i < end; i++) {
      const row = this.rows[i];
      let node = this.mounted.get(row.key);
      const version = row.version ?? row;
      if (!node || this.versions.get(row.key) !== version) {
        const old = node;
        node = document.createElement("div");
        node.className = "sya-virtual-row";
        node.dataset.key = row.key;
        node.append(row.render());
        this.versions.set(row.key, version);
        if (old) {
          this.observer?.unobserve(old);
          if (cursor === old) cursor = old.nextSibling;
          old.replaceWith(node);
        }
        this.observer?.observe(node);
      }
      next.set(row.key, node);
      if (node === cursor) cursor = cursor.nextSibling;
      else if (node.parentNode !== this.body || node.nextSibling !== cursor) this.body.insertBefore(node, cursor);
    }
    for (const [key, node] of this.mounted)
      if (!next.has(key)) this.observer?.unobserve(node);
    this.mounted = next;
  }
  destroy(): void {
    this.viewport.removeEventListener("scroll", this.schedule);
    this.observer?.disconnect();
    this.viewportObserver?.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }
}
