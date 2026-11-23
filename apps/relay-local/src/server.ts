import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { health, MAX_MESSAGE_BYTES, parseClientMessage, PROTOCOL_VERSION } from "@qracer/protocol";
import { WebSocketServer } from "ws";
import { createProbe } from "./probe.ts";
import { createSessions } from "./session.ts";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

export function createRelay(options: {
  staticDir?: string;
  allowedOrigins: string[];
  probeKey?: string;
}) {
  const origins = new Set(options.allowedOrigins);
  const probe = createProbe(origins, options.probeKey);
  const sessions = createSessions(origins);
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (probe.request(request, response)) return;
    if (await sessions.request(request, response)) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
      if (pathname === "/health") {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(health()));
        return;
      }
      if (!options.staticDir || pathname.split("/").some((part) => part.startsWith("."))) {
        response.writeHead(404).end();
        return;
      }
      const root = await realpath(options.staticDir);
      let file = resolve(root, `.${pathname}`);
      if (!inside(root, file)) {
        response.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
      file = await realpath(file);
      const contentType = mime[extname(file)];
      if (!inside(root, file) || !contentType) {
        response.writeHead(404).end();
        return;
      }
      const size = (await stat(file)).size;
      response.writeHead(200, { "Content-Type": contentType, "Content-Length": size });
      if (request.method === "HEAD") response.end();
      else
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    }
  });
  server.on("upgrade", (request, socket, head) => {
    if (probe.upgrade(request, socket, head)) return;
    if (sessions.upgrade(request, socket, head)) return;
    if (
      request.url !== "/ws" ||
      !origins.has(request.headers.origin ?? "") ||
      sockets.clients.size >= 16
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (peer) => {
      let ready = false;
      let windowStart = Date.now();
      let count = 0;
      const deadline = setTimeout(() => peer.close(1008, "HELLO required"), 5000);
      deadline.unref();
      peer.on("close", () => clearTimeout(deadline));
      peer.on("error", () => peer.terminate());
      peer.on("message", (raw, binary) => {
        if (Date.now() - windowStart >= 1000) {
          windowStart = Date.now();
          count = 0;
        }
        const message = binary ? undefined : parseClientMessage(raw.toString());
        if (++count > 60 || !message || peer.bufferedAmount > 8192) {
          peer.close(1008, "Invalid or excessive input");
          return;
        }
        if (!ready && message.type === "HELLO") {
          ready = true;
          clearTimeout(deadline);
          peer.send(JSON.stringify({ type: "WELCOME", protocolVersion: PROTOCOL_VERSION }));
        } else if (ready && message.type === "PING") {
          peer.send(JSON.stringify({ type: "PONG", id: message.id }));
        } else peer.close(1008, "Unexpected message");
      });
    });
  });
  return {
    server,
    close: async () => {
      await probe.close();
      await sessions.close();
      for (const peer of sockets.clients) peer.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
