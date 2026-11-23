import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const { WebSocket } = createRequire(new URL("../apps/relay-local/package.json", import.meta.url))(
  "ws",
);

export async function exerciseSession(base, origin, { key, idleMs = 0 } = {}) {
  const sockets = new Set();
  const headers = { Origin: origin, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const provision = () => fetch(`${base}/session`, { method: "POST", headers, redirect: "error" });
  async function connect(room, socketOrigin = origin) {
    const socket = new WebSocket(`${base.replace(/^http/, "ws")}/session/ws/${room}`, {
      origin: socketOrigin,
      handshakeTimeout: 5000,
    });
    sockets.add(socket);
    const inbox = [];
    socket.on("message", (data) => inbox.push(JSON.parse(String(data))));
    socket.on("error", () => {});
    await once(socket, "open");
    return {
      socket,
      send(message) {
        socket.send(JSON.stringify(message));
      },
      async next(type, filter = () => true) {
        const deadline = Date.now() + 5000;
        do {
          const index = inbox.findIndex((frame) => frame.type === type && filter(frame));
          if (index !== -1) return inbox.splice(index, 1)[0];
          await sleep(15);
        } while (Date.now() < deadline);
        throw new Error(`Missing session frame: ${type}`);
      },
      async close() {
        if (socket.readyState === WebSocket.CLOSED) return;
        const done = once(socket, "close");
        socket.close(1000);
        await done;
      },
    };
  }
  const auth = (peer, role, token, version = 1) =>
    peer.send({ type: "AUTH", role, token, version });
  const state = (peer, phase, epoch) =>
    peer.next("STATE", (f) => f.phase === phase && (epoch === undefined || f.epoch === epoch));
  try {
    const denied = await fetch(`${base}/session`, {
      method: "POST",
      headers: { ...headers, Origin: "https://unlisted.invalid" },
    });
    assert.equal(denied.status, 403);
    const response = await provision();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { room, hostToken, version } = await response.json();
    assert.equal(version, 1);
    assert.match(room, /^[a-f0-9]{32}$/);
    await assert.rejects(() => connect(room, "https://unlisted.invalid"));
    const stranger = await connect(room);
    auth(stranger, "host", "0".repeat(64));
    assert.equal((await stranger.next("ERROR")).code, "UNAUTHORIZED");
    await stranger.close();
    const stale = await connect(room);
    auth(stale, "host", hostToken, 2);
    assert.equal((await stale.next("ERROR")).code, "VERSION_MISMATCH");
    await stale.close();

    const pc = await connect(room);
    auth(pc, "host", hostToken);
    await state(pc, "waiting", 0);
    pc.send({ type: "ROTATE" });
    const invite = await pc.next("INVITE");
    const phone = await connect(room);
    const duplicate = await connect(room);
    auth(phone, "invite", invite.token);
    const pending = await state(pc, "pending", 0);
    assert.equal((await state(phone, "pending", 0)).code, pending.code);
    auth(duplicate, "invite", invite.token);
    assert.equal((await duplicate.next("ERROR")).code, "INVITE_EXPIRED");
    await duplicate.close();
    pc.send({ type: "APPROVE", request: pending.request });
    const resume = await phone.next("RESUME");
    const linked = await state(pc, "connected", 1);
    await state(phone, "connected", 1);
    if (idleMs) await sleep(idleMs);
    await phone.close();
    const disconnected = await state(pc, "reconnecting", 1);
    const resumed = await connect(room);
    auth(resumed, "resume", resume.token);
    const rotated = await resumed.next("RESUME");
    assert.notEqual(rotated.token, resume.token);
    await state(pc, "connected", 2);
    await state(resumed, "connected", 2);

    const replacement = await connect(room);
    pc.send({ type: "ROTATE" });
    auth(replacement, "invite", (await pc.next("INVITE")).token);
    const request = await state(pc, "pending", 2);
    assert.equal(request.linked, true);
    pc.send({ type: "APPROVE", request: request.request });
    await replacement.next("RESUME");
    assert.equal((await resumed.next("ERROR")).code, "REVOKED");
    await state(pc, "connected", 3);

    for (let i = 0; i < 7; i++) assert.equal((await provision()).status, 201);
    assert.equal((await provision()).status, 429);
    pc.send({ type: "END" });
    assert.equal((await replacement.next("ERROR")).code, "ROOM_EXPIRED");
    const deadline = Date.now() + 3000;
    let allocation;
    do {
      allocation = await provision();
      if (allocation.status === 201) break;
      await sleep(50);
    } while (Date.now() < deadline);
    assert.equal(allocation.status, 201, "Ending a session should release quota");
    return { constructorRestarted: linked.boot !== undefined && linked.boot !== disconnected.boot };
  } finally {
    for (const socket of sockets) socket.terminate();
  }
}
