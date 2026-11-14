import { test } from "node:test";
import assert from "node:assert/strict";
import { AnnotationPanel, icon, type UIActions } from "../src/ui";
import { parseAnnotations, STYLES } from "../src/model";
import { installDOM, heading as h, paragraph as p } from "./dom";

test("sidebar renders safe note text, nested headings, filtering, collapse and navigation", () => {
  installDOM();
  const jumps: string[] = [];
  const actions: UIActions = {
    chooseStyle() {},
    apply() {},
    toggleContinuous() {},
    refresh() {},
    navigate(id) {
      jumps.push(id);
    },
    closeToolbar() {},
    manageTool() {},
    deleteTool() {},
    locate() {},
    toggleFollow() {},
  };
  const panel = new AnnotationPanel(actions);
  document.body.append(panel.element);
  panel.setDocument("doc1", "测试文档");
  panel.setAnnotations(
    parseAnnotations(
      h("h1", 1, "第一章") +
        h("h3", 3, "细节") +
        p(
          "p1",
          '<span data-type="mark">&lt;img src=x onerror=alert(1)&gt;</span>',
        ) +
        h("h2", 2, "方法") +
        p(
          "p2",
          '<span data-type="u text" style="color:#b3344b;background-color:#f6ebbd;text-decoration-style:wavy">记住方法</span>',
        ),
    ).annotations,
  );
  assert.equal(panel.element.querySelectorAll(".sya-card").length, 2);
  assert.equal(panel.element.querySelectorAll("img").length, 0);
  assert.equal(panel.element.querySelectorAll(".sya-card__meta").length, 0);
  const cards = panel.element.querySelectorAll<HTMLElement>(".sya-card");
  assert.equal(
    cards[0].style.getPropertyValue("--sya-mark-foreground"),
    "#9aa0a6",
  );
  const sample = cards[1].querySelector<HTMLElement>(".sya-card__sample")!;
  assert.equal(sample.style.color, "rgb(179, 52, 75)");
  assert.equal(sample.style.backgroundColor, "rgb(246, 235, 189)");
  assert.equal(sample.style.textDecorationStyle, "wavy");
  assert.equal(sample.style.textDecorationLine, "underline");
  assert.equal(
    cards[1].style.getPropertyValue("--sya-mark-foreground"),
    "rgb(179,52,75)",
  );
  assert.equal(
    cards[1].style.getPropertyValue("--sya-mark-background"),
    "rgb(246,235,189)",
  );
  panel.setTools(
    STYLES.map((tool) => ({
      ...tool,
      styles: { color: "blue", "background-color": "white" },
    })),
  );
  assert.equal(
    sample.style.color,
    "rgb(179, 52, 75)",
    "historical cards display original formatting rather than an edited tool",
  );
  panel.setTools(STYLES);
  assert.equal(panel.element.querySelector(".sya-level")!.textContent, "H1");
  panel.element.querySelector<HTMLButtonElement>(".sya-card")!.click();
  assert.deepEqual(jumps, ["p1"]);
  panel.element
    .querySelector<HTMLButtonElement>(".sya-heading__toggle")!
    .click();
  assert.equal(panel.element.querySelectorAll(".sya-card").length, 0);
  panel.element
    .querySelector<HTMLButtonElement>('[aria-label="展开全部标题"]')!
    .click();
  const search = panel.element.querySelector("input")!;
  search.value = "方法";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(panel.element.querySelectorAll(".sya-card").length, 1);
  assert.equal(
    panel.element.querySelector(".sya-card__text")!.textContent,
    "记住方法",
  );
  panel.element.querySelector<HTMLButtonElement>('.sya-style-filter [data-tool-id="yellow"]')!.click();
  assert.match(panel.element.textContent!, /没有匹配的标注/);
  panel.setDocument("doc2", "切换后");
  assert.equal(panel.element.querySelectorAll(".sya-card").length, 0);
  panel.destroy();
});

test("settings and refresh use the host icon symbols when available", () => {
  installDOM(
    '<svg><symbol id="iconSettings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></symbol><symbol id="iconRefresh" viewBox="0 0 24 24"><path d="M3 12h18"/></symbol></svg>',
  );
  const holder = document.createElement("div");
  for (const [name, id] of [["settings", "iconSettings"], ["refresh", "iconRefresh"]]) {
    holder.innerHTML = icon(name);
    assert.equal(holder.querySelector("use")!.getAttribute("href"), `#${id}`);
    assert.ok(holder.querySelector("svg")!.classList.contains("sya-icon--native"));
  }
});

test("location reveals the exact card, follows within a section and respects hidden targets", () => {
  installDOM();
  const panel = new AnnotationPanel({
    chooseStyle() {}, apply() {}, toggleContinuous() {}, refresh() {}, navigate() {}, closeToolbar() {}, manageTool() {}, deleteTool() {}, locate() {}, toggleFollow() {},
  });
  document.body.append(panel.element);
  panel.setDocument("doc", "当前位置");
  const annotations = parseAnnotations(h("h1", 1, "章节") + h("h2", 2, "小节") +
    p("p1", '<span data-type="mark">第一处</span>正文<span data-type="u">第二处</span>')).annotations;
  panel.setAnnotations(annotations);
  panel.element.querySelector<HTMLButtonElement>('[aria-label="折叠全部标题"]')!.click();
  const locate = (i: number) => panel.locate(annotations[i].headings, true, annotations[i]);
  assert.equal(locate(1), "located");
  assert.equal(panel.element.querySelector(".sya-card.is-current")?.textContent, "第二处");
  assert.equal(panel.element.querySelectorAll('.sya-heading__toggle[aria-expanded="false"]').length, 0);
  const first = panel.element.querySelector(".sya-card");
  assert.equal(locate(0), "located");
  assert.equal(panel.element.querySelector(".sya-card.is-current"), first, "following reuses mounted cards");
  assert.equal(panel.element.querySelectorAll('[aria-current="location"]').length, 1);
  assert.equal(panel.locate(annotations[0].headings, true, annotations[0], false), "located");
  assert.equal(panel.element.querySelectorAll(".sya-card.is-current, .sya-card[aria-current]").length, 0,
    "an unmarked position clears the previous card while keeping the nearby navigation target");
  assert.equal(locate(0), "located");
  assert.equal(panel.element.querySelector(".sya-card.is-current"), first,
    "returning to the same annotation restores its selection without replacing the card");
  const search = panel.element.querySelector("input")!;
  search.value = "第一处"; search.dispatchEvent(new window.Event("input"));
  assert.equal(locate(1), "filtered", "a visible heading cannot substitute for a hidden card");
  assert.equal(panel.element.querySelectorAll(".sya-card.is-current").length, 0,
    "a filtered target cannot leave another card selected");
  assert.equal(search.value, "第一处");
  panel.setDocument("plain", "无标题");
  const plain = parseAnnotations(p("p", '<span data-type="mark">无标题标注</span>')).annotations;
  panel.setAnnotations(plain);
  assert.equal(panel.locate([], false, plain[0]), "located");
  assert.equal(panel.element.querySelector(".sya-card.is-current")?.textContent, "无标题标注");
  assert.equal(panel.locate([], false, plain[0], false), "located");
  assert.equal(panel.element.querySelectorAll(".sya-card.is-current").length, 0);
  panel.destroy();
});

test("worker query results cannot overwrite a newer filter or document and filters restore per document", async () => {
  installDOM();
  const pending: { request: import("../src/filters").QueryRequest; resolve: (result: import("../src/filters").QueryResult) => void }[] = [];
  const panel = new AnnotationPanel({
    chooseStyle() {}, apply() {}, toggleContinuous() {}, refresh() {}, navigate() {}, closeToolbar() {}, manageTool() {}, deleteTool() {}, locate() {}, toggleFollow() {},
    queryAnnotations(request) { return new Promise((resolve) => pending.push({ request, resolve })); },
  });
  // jsdom has no global computed-style function; supply it for the Worker-facing query path.
  const previous = globalThis.getComputedStyle;
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: window.getComputedStyle.bind(window) });
  try {
    document.body.append(panel.element); panel.setDocument("one", "一");
    const annotations = parseAnnotations(p("p", '<span data-type="u">甲</span>间隔<span data-type="u">乙</span>')).annotations;
    panel.setAnnotations(annotations);
    const search = panel.element.querySelector("input")!; search.value = "甲"; search.dispatchEvent(new window.Event("input"));
    const initial = pending.pop()!;
    search.value = "乙"; search.dispatchEvent(new window.Event("input"));
    const newer = pending.pop()!;
    newer.resolve({ rootId: "one", version: newer.request.version, keys: [annotations[1].key] }); await Promise.resolve();
    initial.resolve({ rootId: "one", version: initial.request.version, keys: annotations.map((a) => a.key) }); await Promise.resolve();
    assert.equal(panel.element.querySelectorAll(".sya-card").length, 1);
    assert.equal(panel.element.querySelector(".sya-card__text")?.textContent, "乙");
    panel.setDocument("two", "二"); panel.setAnnotations(annotations);
    search.value = "甲"; search.dispatchEvent(new window.Event("input"));
    const obsolete = pending.pop()!;
    panel.setDocument("one", "一"); panel.setAnnotations(annotations);
    const restored = pending.pop()!;
    assert.equal(search.value, "乙");
    obsolete.resolve({ rootId: "two", version: obsolete.request.version, keys: [annotations[0].key] }); await Promise.resolve();
    restored.resolve({ rootId: "one", version: restored.request.version, keys: [annotations[1].key] }); await Promise.resolve();
    assert.equal(panel.element.querySelector(".sya-card__text")?.textContent, "乙");
  } finally { panel.destroy(); Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: previous }); }
});
