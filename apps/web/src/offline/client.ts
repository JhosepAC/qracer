import { progressStore } from "../storage/database.ts";

const enabledKey = "qracer.offline.enabled.v1";
const lockKey = "qracer.offline.update.v1";
const changed = () => document.dispatchEvent(new Event("qracer:offline"));
export const supported = isSecureContext && "serviceWorker" in navigator && "caches" in window;
let registration: ServiceWorkerRegistration | undefined;
let owned = "";
let started = false;
const updateFound = () => registration?.installing?.addEventListener("statechange", changed);
export function offlineEnabled() {
  try {
    return localStorage.getItem(enabledKey) !== "false";
  } catch {
    return true;
  }
}
function lock() {
  try {
    const value = JSON.parse(localStorage.getItem(lockKey) ?? "null");
    return value &&
      typeof value.nonce === "string" &&
      value.until > Date.now() &&
      value.until < Date.now() + 15000
      ? (value.nonce as string)
      : "";
  } catch {
    return "";
  }
}
export function updateBlocked() {
  return !!owned || !!lock();
}
function release(nonce: string) {
  if (owned !== nonce) return;
  owned = "";
  try {
    if (lock() === nonce) localStorage.removeItem(lockKey);
  } catch {}
  changed();
}
function rpc(
  target: ServiceWorker,
  type: string,
  timeout = 30000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Offline timeout"));
    }, timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (!event.data || event.data.error) reject(new Error("Offline unavailable"));
      else resolve(event.data);
    };
    target.postMessage({ type }, [channel.port2]);
  });
}
export async function connectOffline() {
  if (!supported || !offlineEnabled()) return;
  if (!started) {
    started = true;
    navigator.serviceWorker.addEventListener("message", async (event) => {
      const data = event.data;
      if (
        !(event.source instanceof ServiceWorker) ||
        event.source.scriptURL !== new URL("/sw.js", location.origin).href ||
        typeof data?.nonce !== "string"
      )
        return;
      if (data.type === "QRACER_UPDATE_RELEASE") return release(data.nonce);
      if (data.type !== "QRACER_UPDATE_CHECK" || !event.ports[0]) return;
      let allowed =
        document.getElementById("app")?.dataset.mode === "menu" &&
        (!lock() || lock() === data.nonce);
      if (allowed) {
        try {
          localStorage.setItem(
            lockKey,
            JSON.stringify({ nonce: data.nonce, until: Date.now() + 10000 }),
          );
          owned = data.nonce;
          setTimeout(() => release(data.nonce), 10000);
          changed();
          await progressStore.flush();
          allowed =
            lock() === data.nonce && document.getElementById("app")?.dataset.mode === "menu";
        } catch {
          allowed = false;
        }
      }
      event.ports[0].postMessage({ nonce: data.nonce, allowed });
      event.ports[0].close();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === lockKey) {
        changed();
        setTimeout(changed, 10500);
      }
    });
    if (lock()) setTimeout(changed, 10500);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateBlocked() && document.getElementById("app")?.dataset.mode === "menu")
        location.reload();
      else changed();
    });
  }
  const next = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  if (registration !== next) registration?.removeEventListener("updatefound", updateFound);
  registration = next;
  registration.addEventListener("updatefound", updateFound);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Offline install timeout")), 20000);
    void navigator.serviceWorker.ready.then(() => {
      clearTimeout(timer);
      resolve();
    }, reject);
  });
  changed();
}
export function updateWaiting() {
  return !!registration?.waiting;
}
export async function offlineStatus() {
  if (!registration?.active || !offlineEnabled()) return;
  return rpc(registration.active, "STATUS");
}
export async function prepareOffline() {
  try {
    localStorage.setItem(enabledKey, "true");
  } catch {}
  await connectOffline();
  if (!registration?.active) throw new Error("Offline unavailable");
  return rpc(registration.active, "PREPARE");
}
export async function downloadWorlds() {
  if (!registration?.active) throw new Error("Offline unavailable");
  return rpc(registration.active, "WORLDS");
}
export async function applyUpdate() {
  if (!registration?.waiting) return false;
  const result = await rpc(registration.waiting, "UPDATE", 8000);
  return result.activated === true;
}
export async function evictOptional() {
  if (!supported) return;
  for (const name of await caches.keys())
    if (name.startsWith("qracer-offline-") && name.endsWith("-extra")) await caches.delete(name);
  changed();
}
export async function clearDownloads() {
  try {
    localStorage.setItem(enabledKey, "false");
  } catch {}
  const current =
    registration ??
    (supported ? await navigator.serviceWorker.getRegistration("/sw.js") : undefined);
  for (const target of [current?.waiting, current?.active])
    if (target) await rpc(target, "DISABLE", 5000).catch(() => undefined);
  current?.removeEventListener("updatefound", updateFound);
  await current?.unregister();
  if (supported)
    for (const name of await caches.keys())
      if (name.startsWith("qracer-offline-") && name !== "qracer-offline-control-v1")
        await caches.delete(name);
  registration = undefined;
  changed();
}
export function localRelay() {
  try {
    const host = new URL(import.meta.env.VITE_SESSION_RELAY || location.origin).hostname;
    return /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      host,
    );
  } catch {
    return false;
  }
}
