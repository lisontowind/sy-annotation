import { build } from "esbuild";
import { readdir, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir(".test-build", { recursive: true });
const files = (await readdir("tests")).filter((file) =>
  file.endsWith(".test.ts"),
);
await build({
  entryPoints: files.map((file) => `tests/${file}`),
  outdir: ".test-build",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...files.map((file) => `.test-build/${file.replace(/\.ts$/, ".js")}`),
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
