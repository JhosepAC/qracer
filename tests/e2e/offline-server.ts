import type { Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Isolated real HTTP origin; revisions never mutate the distribution used by other tests. */
export async function offlineServer() {
  const root = resolve("apps/web/dist");
  const files = new Map<string, Buffer>();
  async function collect(dir: string) {
    for (const entry of await readdir(resolve(root, `.${dir}`), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await collect(path);
      else files.set(path, await readFile(resolve(root, `.${path}`)));
    }
  }
  await collect("");
  let script = files.get("/sw.js")?.toString("utf8") ?? "";
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://local");
    requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/session" || url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end('{"private":"test-secret"}');
      return;
    }
    const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const bytes = path === "/sw.js" ? Buffer.from(script) : files.get(path);
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    const extension = path.split(".").at(-1) ?? "";
    const mime: Record<string, string> = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      woff2: "font/woff2",
      wasm: "application/wasm",
      glb: "model/gltf-binary",
    };
    response.writeHead(200, {
      "Content-Type": mime[extension] ?? "text/plain",
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    files,
    requests,
    revise() {
      script = `${script.replace(/id:"[a-f0-9]{20}"/, `id:"${"e".repeat(20)}"`)}\n// update test`;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Deterministic simulation time on software GPU runners; render/cache remain real. */
export async function prepareGraphics(page: Page) {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.addInitScript(() => {
    localStorage.setItem("qracer.graphics.quality", "low");
    localStorage.setItem("qracer.presentation.v1", JSON.stringify({ muted: true }));
    const request = window.requestAnimationFrame.bind(window);
    let time = 0;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        time += 1000 / 12;
        callback(time);
      });
  });
}
