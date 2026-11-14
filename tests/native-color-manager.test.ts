import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeColorManager } from "../src/native-color-manager";
import { installDOM } from "./dom";

test("native color management keeps a suspended filter draft and restores it after the native dialog closes", async () => {
  const dom = installDOM('<dialog class="sya-manager" open><input value="未应用的筛选条件"></dialog>');
  Object.defineProperty(globalThis, "MutationObserver", { value: dom.window.MutationObserver, configurable: true });
  const parent = document.querySelector<HTMLDialogElement>("dialog")!;
  const draft = parent.querySelector("input")!;
  let native: HTMLElement | undefined, settingsRemoved = false, refreshes = 0;
  const manager = new NativeColorManager(() => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="config__side"><button data-name="appearance"></button></div>';
    root.querySelector("button")!.addEventListener("click", () => {
      const colors = document.createElement("button"); colors.id = "manageColors-color";
      colors.addEventListener("click", () => {
        root.className = "b3-dialog--open";
        queueMicrotask(() => { native = document.createElement("div"); native.className = "b3-dialog--open"; document.body.append(native); });
      }); root.append(colors);
    });
    document.body.append(root);
    return { element: root, destroy() { settingsRemoved = true; root.remove(); } };
  }, () => refreshes++);
  const opened = manager.open("color");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(native?.isConnected); assert.equal(parent.open, false); assert.equal(settingsRemoved, true);
  native.remove(); await opened;
  assert.equal(parent.open, true); assert.equal(parent.querySelector("input"), draft);
  assert.equal(draft.value, "未应用的筛选条件"); assert.equal(refreshes, 1);
});

test("unavailable native settings restore the calling dialog", async () => {
  const dom = installDOM('<dialog class="sya-manager" open></dialog>');
  Object.defineProperty(globalThis, "MutationObserver", { value: dom.window.MutationObserver, configurable: true });
  const manager = new NativeColorManager(() => undefined, () => {});
  await assert.rejects(manager.open("style1"), /暂不支持/);
  assert.equal(document.querySelector<HTMLDialogElement>("dialog")!.open, true);
});
