import { build, context } from "esbuild";
import { mkdir, copyFile, readdir, cp } from "node:fs/promises";

await mkdir("dist/i18n", { recursive: true });
for (const file of ["plugin.json", "README.md", "README.en.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "icon.png", "preview.png"])
  await copyFile(file, `dist/${file}`);
await cp("docs/assets", "dist/docs/assets", { recursive: true });
await mkdir("dist/docs", { recursive: true });
await copyFile("docs/DEVELOPMENT.md", "dist/docs/DEVELOPMENT.md");
await copyFile("src/index.css", "dist/index.css");
for (const file of await readdir("i18n"))
  await copyFile(`i18n/${file}`, `dist/i18n/${file}`);
const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["siyuan"],
  footer: { js: "module.exports = module.exports.default;" },
  sourcemap: true,
  minify: false,
};
const workerOptions = {
  entryPoints: ["src/index-worker.ts"],
  bundle: true,
  outfile: "dist/index-worker.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
};
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  const worker = await context(workerOptions);
  await worker.watch();
  const { watch } = await import("node:fs");
  watch("src/index.css", async () => {
    await copyFile("src/index.css", "dist/index.css");
  });
  console.log("Watching plugin source; output: dist/");
} else {
  await build(options);
  await build(workerOptions);
  console.log("Built installable plugin in dist/");
}
