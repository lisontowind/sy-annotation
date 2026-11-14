import { JSDOM } from "jsdom";

export function installDOM(html = "") {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "http://localhost",
  });
  for (const key of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "DOMParser",
    "NodeFilter",
    "Range",
    "CustomEvent",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  }
  return dom;
}

export const paragraph = (id: string, content: string) =>
  `<div data-node-id="${id}" data-type="NodeParagraph"><div contenteditable="true">${content}</div><div class="protyle-attr" contenteditable="false"></div></div>`;
export const heading = (id: string, level: number, text: string) =>
  `<div data-node-id="${id}" data-type="NodeHeading" data-subtype="h${level}"><div contenteditable="true">${text}</div></div>`;
