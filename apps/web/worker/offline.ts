/// <reference lib="webworker" />
export {};
declare const __QRACER_OFFLINE__: {
  id: string;
  entries: { url: string; size: number; hash: string; optional: boolean }[];
};
const worker = self as unknown as ServiceWorkerGlobalScope;
const manifest = __QRACER_OFFLINE__;
const prefix = "qracer-offline-";
const core = `${prefix}${manifest.id}-core`;
const extra = `${prefix}${manifest.id}-extra`;
const control = `${prefix}control-v1`;
const flag = new URL("/__qracer_offline_enabled", worker.location.origin).href;
const entries = new Map(manifest.entries.map((entry) => [entry.url, entry]));
let enabled: Promise<boolean> | undefined;
function isEnabled() {
  enabled ??= caches.open(control).then(async (cache) => (await cache.match(flag))?.status !== 403);
  return enabled;
}
async function setEnabled(value: boolean) {
  await (await caches.open(control)).put(flag, new Response("", { status: value ? 200 : 403 }));
  enabled = Promise.resolve(value);
}
async function clearExtras() {
  for (const name of await caches.keys())
    if (name.startsWith(prefix) && name.endsWith("-extra")) await caches.delete(name);
}
async function resource(url: string) {
  const entry = entries.get(url);
  if (!entry) throw new Error("Not allowlisted");
  const cache = await caches.open(entry.optional ? extra : core);
  const cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetch(url, { credentials: "omit", cache: "no-store", redirect: "error" });
  if (!response.ok || response.type === "opaque") throw new Error("Unavailable");
  const bytes = await response.clone().arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.byteLength !== entry.size || digest !== entry.hash) throw new Error("Build mismatch");
  try {
    await cache.put(url, response.clone());
  } catch {
    await clearExtras();
    if (!entry.optional) await cache.put(url, response.clone());
  }
  return response;
}
async function prepare(optional = false) {
  // Bounded concurrency avoids a burst of large GLBs while the menu is visible.
  const list = manifest.entries.filter((entry) => entry.optional === optional);
  for (let i = 0; i < list.length; i += 3)
    await Promise.all(list.slice(i, i + 3).map((entry) => resource(entry.url)));
}
worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await setEnabled(true);
      try {
        await prepare();
      } catch (error) {
        await caches.delete(core);
        await caches.delete(extra);
        throw error;
      }
    })(),
  );
});
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const builds = (await caches.keys()).filter(
        (name) => name.startsWith(prefix) && name.endsWith("-core") && name !== core,
      );
      const keep = builds.at(-1);
      for (const name of builds)
        if (name !== keep) {
          await caches.delete(name);
          await caches.delete(name.replace(/-core$/, "-extra"));
        }
      await worker.clients.claim();
    })(),
  );
});
worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== worker.location.origin ||
    url.search ||
    request.headers.has("authorization") ||
    !entries.has(url.pathname)
  )
    return;
  event.respondWith(
    (async () => {
      if (!(await isEnabled())) return fetch(request);
      try {
        return await resource(url.pathname);
      } catch {
        return new Response(
          "QRacer: contenido no descargado o versión incompatible. Conecta la red y vuelve al menú.",
          {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          },
        );
      }
    })(),
  );
});
async function status() {
  const available: string[] = [];
  const primary = await caches.open(core),
    optional = await caches.open(extra);
  let ready = true;
  for (const entry of manifest.entries) {
    const exists = !!(await (entry.optional ? optional : primary).match(entry.url));
    if (!entry.optional && !exists) ready = false;
    if (entry.optional && exists) available.push(entry.url);
  }
  return { id: manifest.id, ready, available, enabled: await isEnabled() };
}
async function ask(client: WindowClient, nonce: string) {
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.nonce === nonce && event.data?.allowed === true);
    };
    client.postMessage({ type: "QRACER_UPDATE_CHECK", nonce }, [channel.port2]);
  });
}
let updating = false;
async function activateSafely() {
  if (updating) return false;
  updating = true;
  const nonce = crypto.randomUUID();
  const clients = (
    await worker.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).filter((client) => new URL(client.url).pathname.startsWith("/play/"));
  const allowed =
    clients.length > 0 &&
    (await Promise.all(clients.map((client) => ask(client, nonce)))).every(Boolean);
  if (allowed) await worker.skipWaiting();
  else for (const client of clients) client.postMessage({ type: "QRACER_UPDATE_RELEASE", nonce });
  updating = false;
  return allowed;
}
worker.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (
    !port ||
    !event.source ||
    !("url" in event.source) ||
    !new URL(event.source.url).pathname.startsWith("/play/")
  )
    return;
  event.waitUntil(
    (async () => {
      try {
        switch (event.data?.type) {
          case "STATUS":
            port.postMessage(await status());
            break;
          case "PREPARE":
            await setEnabled(true);
            await prepare();
            port.postMessage(await status());
            break;
          case "WORLDS":
            await prepare(true);
            port.postMessage(await status());
            break;
          case "EVICT":
            await clearExtras();
            port.postMessage({ ok: true });
            break;
          case "UPDATE":
            port.postMessage({ activated: await activateSafely() });
            break;
          case "DISABLE":
            await setEnabled(false);
            for (const name of await caches.keys())
              if (name.startsWith(prefix) && name !== control) await caches.delete(name);
            await worker.registration.unregister();
            port.postMessage({ ok: true });
            break;
        }
      } catch {
        port.postMessage({ error: true });
      } finally {
        port.close();
      }
    })(),
  );
});
