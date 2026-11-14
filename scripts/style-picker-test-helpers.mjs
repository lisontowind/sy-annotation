import assert from "node:assert/strict";

export async function selectStyle(page, selector, id, options = {}) {
  const root = page.locator(selector).first();
  if (await root.evaluate(node => node.tagName === "SELECT")) return root.selectOption(id);
  const picker = await root.evaluate(node => node.matches("details.sya-style-picker")) ? root : root.locator(".sya-style-picker").first();
  if (!await picker.evaluate(node => node.open)) await picker.locator(":scope > summary").click();
  const button = picker.locator(`[data-tool-id="${id}"], [data-style-choice-id="${id}"]`).first();
  assert.equal(await button.count(), 1, `Style choice is present: ${id}`);
  await button.click(options);
}
