import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import english from "../i18n/en_US.json";
import { getLocale, setLocale, t, toolLabel } from "../src/i18n";
import { loadToolConfig } from "../src/model";
import { AnnotationPanel, type UIActions } from "../src/ui";
import { ToolManager } from "../src/tool-manager";
import { installDOM } from "./dom";

afterEach(() => setLocale(undefined));

test("language follows SiYuan, normalizes tags, and preserves interpolation values", () => {
  installDOM();
  document.documentElement.lang = "en-US";
  assert.equal(getLocale(), "en-US");
  assert.equal(t("找到 {0} 处标注", 12), "Found 12 annotations");
  Object.assign(window, { siyuan: { config: { lang: "zh_CN" } } });
  assert.equal(getLocale(), "zh-CN");
  setLocale("en_US");
  assert.equal(t("上移 {0}", "我的 $& {0} 工具"), "Move 我的 $& {0} 工具 up");
  setLocale("zh-TW");
  assert.equal(t("找到 {0} 处标注", 12), "找到 12 处标注");
  setLocale("de-DE");
  assert.equal(t("重试"), "Retry");
});

test("every localized source message has an English translation with matching placeholders", () => {
  const dictionary: Record<string, string> = english.messages;
  const placeholders = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();
  for (const [key, value] of Object.entries(dictionary)) assert.deepEqual(placeholders(key), placeholders(value), key);
  for (const file of readdirSync("src").filter(f => f.endsWith(".ts"))) {
    const sf = ts.createSourceFile(file, readFileSync(`src/${file}`, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        assert.ok(dictionary[key], `Missing English message in ${file}: ${key}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
});

test("English UI translates built-ins without rewriting saved or custom tool names", async () => {
  const dom = installDOM(); setLocale("en-US");
  Object.defineProperty(globalThis, "getComputedStyle", { value: dom.window.getComputedStyle.bind(dom.window), configurable: true });
  Object.defineProperty(globalThis, "CSS", { value: { supports: () => true }, configurable: true });
  const config = loadToolConfig(null);
  const before = JSON.stringify(config);
  assert.equal(toolLabel(config.tools[0]), "Yellow highlight");
  assert.equal(toolLabel({ id: "custom", label: "黄色高亮" }), "黄色高亮");
  assert.equal(toolLabel({ id: "yellow", label: "我的重点" }), "我的重点");
  const actions: UIActions = { chooseStyle() {}, apply() {}, toggleContinuous() {}, refresh() {}, navigate() {}, closeToolbar() {}, manageTool() {}, deleteTool() {}, locate() {}, toggleFollow() {} };
  const panel = new AnnotationPanel(actions);
  assert.match(panel.element.textContent ?? "", /Annotation Outline/);
  assert.doesNotMatch(panel.element.textContent ?? "", /[\u4e00-\u9fff]/);
  panel.toolbar.update("yellow", true, 2, config.tools);
  assert.match(panel.element.textContent ?? "", /Yellow highlight/);
  assert.match(panel.element.textContent ?? "", /2 this session/);
  panel.destroy();
  let saved = config.tools;
  const manager = new ToolManager(config.tools, async tools => { saved = tools; }, "yellow");
  assert.equal(manager.element.querySelector<HTMLInputElement>('[data-field="label"]')?.value, "Yellow highlight");
  manager.element.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  assert.equal(saved[0].label, "黄色高亮");
  assert.equal(JSON.stringify(config), before);
  manager.close();
});
