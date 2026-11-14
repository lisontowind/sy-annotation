import { t } from "./i18n";
import type { NativeColorGroup } from "./native-styles";

interface SettingsDialog { element: HTMLElement; destroy(): void; }

function waitFor<T>(read: () => T | undefined, signal: AbortSignal, timeout = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const check = () => {
      const result = read();
      if (result !== undefined) { cleanup(); resolve(result); }
    };
    const observer = new MutationObserver(check);
    if (signal.aborted) { abort(); return; }
    observer.observe(document.body, { childList: true, subtree: true });
    signal.addEventListener("abort", abort, { once: true });
    if (timeout) timer = setTimeout(() => { cleanup(); reject(new Error(t("未能打开思源颜色管理，请从思源设置中打开"))); }, timeout);
    check();
  });
}

/** Use SiYuan's settings entry; its native dialog owns all color changes. */
export class NativeColorManager {
  private controller?: AbortController;
  constructor(private openSettings: () => SettingsDialog | undefined, private refreshed: () => void) {}

  async open(group: NativeColorGroup): Promise<void> {
    if (this.controller) return;
    const controller = this.controller = new AbortController();
    const suspended = [...document.querySelectorAll<HTMLDialogElement>("dialog.sya-manager[open]")];
    // Native SiYuan dialogs live outside HTML dialogs and would otherwise remain inert.
    for (const dialog of suspended) {
      if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open");
    }
    let settings: SettingsDialog | undefined;
    try {
      settings = this.openSettings();
      if (!settings) throw new Error(t("当前思源版本暂不支持打开颜色管理，请升级后重试"));
      const root = settings.element;
      const appearance = await waitFor(() => root.querySelector<HTMLElement>('.config__side [data-name="appearance"]') ?? undefined, controller.signal);
      appearance.click();
      const button = await waitFor(() => root.querySelector<HTMLButtonElement>(`#manageColors-${group}`) ?? undefined, controller.signal);
      // Settings attach slot listeners after inserting their controls into the DOM.
      await new Promise<void>(resolve => {
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve()); else queueMicrotask(resolve);
      });
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (button.disabled) throw new Error(t("当前工作空间不可修改颜色"));
      const previous = new Set(document.querySelectorAll(".b3-dialog--open"));
      previous.add(root); // SiYuan applies its opening class on the next animation frame.
      button.click();
      const manager = await waitFor(() => [...document.querySelectorAll<HTMLElement>(".b3-dialog--open")].find(node => !previous.has(node)), controller.signal);
      settings.destroy(); settings = undefined;
      await waitFor(() => !manager.isConnected ? true : undefined, controller.signal, 0);
    } finally {
      settings?.destroy();
      controller.abort(); this.controller = undefined;
      for (const dialog of suspended) if (dialog.isConnected && !dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
      }
      this.refreshed();
    }
  }

  destroy(): void { this.controller?.abort(); }
}
