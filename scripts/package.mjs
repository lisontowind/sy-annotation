import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync } from "fflate";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const files = {};
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
// Collect only installable files; stale build output must never reintroduce documentation images.
const required = new Set([
  "plugin.json",
  "index.js",
  "index-worker.js",
  "index.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "docs/DEVELOPMENT.md",
  ...Object.values(manifest.readme),
  manifest.icon,
  manifest.preview,
]);
for (const name of required) {
  assert.ok(typeof name === "string" && name && !path.isAbsolute(name) && !name.split(/[\\/]/).includes(".."), `Invalid package entry: ${name}`);
  files[name] = await readFile(path.join("dist", name));
  assert.ok(files[name]?.length, `Missing plugin entry: ${name}`);
}
for (const file of await readdir("dist/i18n", { withFileTypes: true })) {
  if (file.isFile() && file.name.endsWith(".json")) files[`i18n/${file.name}`] = await readFile(path.join("dist/i18n", file.name));
}
const context = {
  module: { exports: {} },
  require: (name) => {
    assert.equal(
      name,
      "siyuan",
      "The plugin must not depend on another runtime package",
    );
    return { Plugin: class Plugin {} };
  },
};
vm.runInNewContext(files["index.js"].toString(), context);
assert.equal(
  typeof context.module.exports,
  "function",
  "CommonJS entry must export the plugin constructor",
);
for (const field of ["icon", "preview"]) {
  const name = manifest[field];
  assert.ok(files[name]?.length, `Missing declared ${field}: ${name}`);
  assert.ok(files[name].length <= (field === "icon" ? 64 : 512) * 1024, `${field} exceeds marketplace size limit`);
}
for (const readme of new Set(Object.values(manifest.readme))) {
  const markdown = files[readme]?.toString();
  assert.ok(markdown, `Missing declared README: ${readme}`);
  for (const [, resource] of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(resource)) continue;
    assert.ok(files[resource]?.length, `README resource missing from package: ${resource}`);
  }
}
await mkdir("artifacts", { recursive: true });
const target = `artifacts/${manifest.name}-${manifest.version}.zip`;
const archive = zipSync(files, { level: 9 });
await writeFile(target, archive);
await writeFile("artifacts/package.zip", archive);
console.log(`Plugin package: ${target}`);
console.log("Marketplace attachment: artifacts/package.zip (local candidate, not published)");
