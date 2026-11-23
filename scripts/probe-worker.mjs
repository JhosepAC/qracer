import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";

const { WebSocket } = createRequire(new URL("../apps/relay-local/package.json", import.meta.url))(
  "ws",
);
export const testProbeKey = "a".repeat(64); // Emulator fixture, never a deployed credential.
const origin = "http://127.0.0.1:8787";

export async function smokeProbeWorker(base) {
  const headers = { Origin: origin, Authorization: `Bearer ${testProbeKey}` };
  const create = () => fetch(`${base}/probe/session`, { method: "POST", headers });
  assert.equal((await fetch(`${base}/probe/session`, { method: "POST" })).status, 403);
  assert.equal(
    (await fetch(`${base}/probe/session`, { method: "POST", headers: { Origin: origin } })).status,
    403,
  );
  const response = await create();
  assert.equal(response.status, 201);
  const keys = await response.json();
  const open = [];
  async function connect(role) {
    const peer = new WebSocket(`${base.replace("http", "ws")}/probe/ws/${keys.id}`, { origin });
    open.push(peer);
    const messages = [];
    peer.on("message", (data) => messages.push(JSON.parse(String(data))));
    peer.on("error", () => {});
    await once(peer, "open");
    peer.send(JSON.stringify({ type: "AUTH", role, token: keys[`${role}Token`] }));
    return { peer, messages };
  }
  async function until(condition) {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Probe response timed out");
      await new Promise((done) => setTimeout(done, 10));
    }
  }
  try {
    const host = await connect("host");
    await until(() => host.messages.some((v) => v.type === "READY"));
    const controller = await connect("controller");
    await until(() => controller.messages.some((v) => v.type === "READY"));
    controller.peer.send(
      JSON.stringify({ type: "INPUT", seq: 1, steer: 0.7, throttle: 1, brake: 0 }),
    );
    await until(() => host.messages.some((v) => v.type === "INPUT" && v.steer === 0.7));
    controller.peer.close();
    await once(controller.peer, "close");
    await until(() => host.messages.some((v) => v.type === "PEER" && !v.connected));
    const reused = await connect("controller");
    assert.equal((await once(reused.peer, "close"))[0], 1008);
    host.peer.send("x".repeat(16385));
    assert.equal((await once(host.peer, "close"))[0], 1008);
    for (let i = 1; i < 8; i++) assert.equal((await create()).status, 201);
    assert.equal((await create()).status, 429);
    console.log(
      "Worker probe passed: SQLite, WSS adapter, role credentials, one-use invitation, size/admission limits (emulated).",
    );
  } finally {
    for (const peer of open) peer.terminate();
  }
}
