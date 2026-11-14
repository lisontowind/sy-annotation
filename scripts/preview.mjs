import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function startPreview(port = 4173) {
  await mkdir(".test-build/preview", { recursive: true });
  await build({
    entryPoints: ["preview/app.ts"],
    outfile: ".test-build/preview/app.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    alias: { siyuan: path.resolve("preview/mock-siyuan.ts") },
  });
  await build({
    entryPoints: ["src/index-worker.ts"],
    outfile: ".test-build/preview/index-worker.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
  });
  const routes = {
    "/": "preview/index.html",
    "/preview/host.css": "preview/host.css",
    "/src/index.css": "src/index.css",
    "/preview/app.js": ".test-build/preview/app.js",
    "/plugins/sy-annotation/index-worker.js":
      ".test-build/preview/index-worker.js",
  };
  const server = createServer(async (request, response) => {
    const route = routes[new URL(request.url, "http://localhost").pathname];
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const data = await readFile(route);
      response.writeHead(200, {
        "Content-Type": route.endsWith(".css")
          ? "text/css; charset=utf-8"
          : route.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/html; charset=utf-8",
      });
      response.end(data);
    } catch {
      response.writeHead(500);
      response.end("Preview unavailable");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve("scripts/preview.mjs")
) {
  const { url } = await startPreview();
  console.log(`Plugin preview (mock SiYuan host): ${url}`);
}
