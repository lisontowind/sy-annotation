import type { IProtyle } from "siyuan";
import { t } from "../src/i18n";

class Bus {
  private target = new EventTarget();
  on(name: string, callback: EventListener) { this.target.addEventListener(name, callback); }
  off(name: string, callback: EventListener) { this.target.removeEventListener(name, callback); }
  emit(name: string, detail: unknown) { this.target.dispatchEvent(new CustomEvent(name, { detail })); }
}
export const bus = new Bus();
export let current: IProtyle;
export const setEditor = (editor: IProtyle) => { current = editor; };
export class Plugin {
  app = {};
  eventBus = bus;
  name = "sy-annotation";
  displayName = "标注大纲";
  commands: { langKey: string; callback: () => void; hotkey?: string }[] = [];
  async loadData(key: string) { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  async saveData(key: string, data: unknown) { localStorage.setItem(key, JSON.stringify(data)); }
  addIcons(svg: string) { const node = document.createElement("div"); node.innerHTML = `<svg style="display:none">${svg}</svg>`; document.body.append(node); }
  addDock(options: { init: (dock: { element: HTMLElement }) => void }) { options.init({ element: document.querySelector<HTMLElement>("#dock")! }); }
  addCommand(command: { langKey: string; callback: () => void }) { this.commands.push(command); }
  addTopBar(options: { callback: () => void; title?: string }) { const button = document.createElement("button"); button.textContent = `✎ ${options.title ?? t("标注工具栏")}`; button.addEventListener("click", options.callback); document.querySelector("#topbar")!.append(button); return button; }
}
export const getAllEditor = () => [{ protyle: current }];
export const getActiveTab = () => ({ model: { editor: { protyle: current } } });
export const openTab = (options: { doc: { id: string } }) => { document.querySelector(`[data-node-id="${options.doc.id}"]`)?.scrollIntoView({ block: "center" }); bus.emit("loaded-protyle-dynamic", { protyle: current }); };
let messageTimer: ReturnType<typeof setTimeout>;
export const showMessage = (text: string) => {
  const node = document.querySelector<HTMLElement>("#messages")!;
  node.textContent = text;
  node.style.display = "block";
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { node.style.display = "none"; }, 3500);
};
