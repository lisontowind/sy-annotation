import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync } from "fflate";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const files = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else if (!entry.name.endsWith(".map"))
      files[path.relative("dist", filename).split(path.sep).join("/")] =
        await readFile(filename);
  }
}
await collect("dist");
for (const name of [
  "plugin.json",
  "index.js",
  "index-worker.js",
  "index.css",
  "README.md",
  "README.en.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "icon.png",
  "preview.png",
  "docs/assets/overview.png",
  "docs/assets/usage-01-annotate.png",
  "docs/assets/usage-02-outline.png",
  "docs/assets/usage-03-filter-batch.png",
  "docs/assets/usage-04-tools.png",
  "docs/assets/interface-dark.png",
])
  assert.ok(files[name]?.length, `Missing plugin entry: ${name}`);
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
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
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
