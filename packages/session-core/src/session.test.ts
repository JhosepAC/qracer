import { expect, it } from "vitest";
import { createRoom, randomId, RoomSession } from "./session.ts";
import {
  AUTH_MS,
  type ClientFrame,
  INVITE_MS,
  RECONNECT_MS,
  ROOM_MS,
  SESSION_VERSION,
} from "./wire.ts";

async function fixture() {
  let now = 1_000_000;
  const { state, creation } = await createRoom(now);
  const room = new RoomSession(state);
  const open = () => {
    const id = randomId();
    expect(room.accept(id, now)).toBe(true);
    return id;
  };
  const send = (id: string, frame: ClientFrame) =>
    room.receive(id, JSON.stringify(frame), () => now);
  const auth = (id: string, role: "host" | "invite" | "resume", token: string) =>
    send(id, { type: "AUTH", version: SESSION_VERSION, role, token });
  const host = open();
  await auth(host, "host", creation.hostToken);
  async function rotate() {
    const frames = await send(host, { type: "ROTATE" });
    const invite = frames.find(({ frame }) => frame.type === "INVITE")?.frame;
    if (invite?.type !== "INVITE") throw new Error("Invite missing");
    return invite;
  }
  async function link(id: string) {
    const frames = await send(host, { type: "APPROVE", request: id });
    const rejoin = frames.find(({ frame }) => frame.type === "RESUME")?.frame;
    if (rejoin?.type !== "RESUME") throw new Error("Resume token missing");
    return rejoin.token;
  }
  return {
    room,
    host,
    creation,
    open,
    send,
    auth,
    rotate,
    link,
    now: () => now,
    jump: (ms: number) => {
      now += ms;
    },
  };
}

it("has separate roles and one concurrent invitation claimant requiring host approval", async () => {
  const s = await fixture();
  const invite = await s.rotate();
  const first = s.open();
  const second = s.open();
  const forged = s.open();
  expect(await s.auth(forged, "host", invite.token)).toMatchObject([
    { frame: { code: "UNAUTHORIZED" }, close: true },
  ]);
  const results = await Promise.all(
    [first, second].map((id) => s.auth(id, "invite", invite.token)),
  );
  const pending = results
    .flat()
    .filter(
      ({ frame, id }) => frame.type === "STATE" && frame.phase === "pending" && id === s.host,
    );
  expect(pending).toHaveLength(1);
  expect(s.room.state.controller).toBeUndefined();
  const claimant = s.room.state.pending?.id;
  if (!claimant) throw new Error("No pending claim");
  const token = await s.link(claimant);
  expect(s.room.state.controller?.id).toBe(claimant);
  expect(s.room.state.epoch).toBe(1);
  expect(JSON.stringify(s.room.state)).not.toContain(token);
  expect(JSON.stringify(s.room.state)).not.toContain(invite.token);
  expect(JSON.stringify(s.room.state)).not.toContain(s.creation.hostToken);
  expect(await s.auth(s.open(), "invite", invite.token)).toMatchObject([
    { frame: { code: "INVITE_EXPIRED" } },
  ]);
});

it("retains the approved controller until replacement, invalidates tokens and rolls the epoch", async () => {
  const s = await fixture();
  const first = s.open();
  await s.auth(first, "invite", (await s.rotate()).token);
  const oldToken = await s.link(first);
  const candidate = s.open();
  await s.auth(candidate, "invite", (await s.rotate()).token);
  expect(s.room.state.controller?.id).toBe(first);
  await s.send(s.host, { type: "REJECT", request: candidate });
  expect(s.room.state.controller?.id).toBe(first);
  const second = s.open();
  await s.auth(second, "invite", (await s.rotate()).token);
  const token = await s.link(second);
  expect(s.room.state.epoch).toBe(2);
  expect(await s.auth(s.open(), "resume", oldToken)).toMatchObject([
    { frame: { code: "UNAUTHORIZED" } },
  ]);
  s.room.remove(second, s.now());
  s.jump(RECONNECT_MS - 1);
  const resumed = s.open();
  const frames = await s.auth(resumed, "resume", token);
  expect(frames[0]).toMatchObject({ id: resumed, frame: { type: "RESUME" } });
  expect(s.room.state.epoch).toBe(3);
  expect(await s.auth(s.open(), "resume", token)).toMatchObject([
    { frame: { code: "UNAUTHORIZED" } },
  ]);
  await s.send(s.host, { type: "REVOKE" });
  expect(s.room.state.controller).toBeUndefined();
  expect(s.room.state.epoch).toBe(4);
});

it("restores attachments, expires unauthenticated peers and terminates a departed host or room", async () => {
  const s = await fixture();
  const controller = s.open();
  await s.auth(controller, "invite", (await s.rotate()).token);
  await s.link(controller);
  const stranger = s.open();
  const restored = new RoomSession(structuredClone(s.room.state), s.room.peers.values());
  expect(restored.nextDeadline()).toBe(s.now() + AUTH_MS);
  expect(restored.expire(s.now() + AUTH_MS)).toMatchObject([
    { id: stranger, frame: { code: "AUTH_REQUIRED" }, close: true },
  ]);
  expect(restored.nextDeadline()).toBe(s.now() + ROOM_MS);
  expect(restored.remove(s.host, s.now() + AUTH_MS)).toMatchObject([
    { id: controller, frame: { phase: "reconnecting" } },
  ]);
  expect(restored.expire(s.now() + AUTH_MS + RECONNECT_MS)).toMatchObject([
    { id: controller, frame: { code: "ROOM_EXPIRED" }, close: true },
  ]);
  expect(restored.accept(randomId(), s.now())).toBe(false);
});

it("rejects version mismatch, bounds invitations and expires an unpaired room", async () => {
  const s = await fixture();
  expect(
    await s.send(s.open(), { type: "AUTH", version: 2, role: "host", token: s.creation.hostToken }),
  ).toMatchObject([{ frame: { code: "VERSION_MISMATCH" }, close: true }]);
  const invite = await s.rotate();
  s.jump(INVITE_MS - 1);
  expect((await s.rotate()).until).toBe(invite.until);
  s.jump(1);
  expect(s.room.expire(s.now())).toMatchObject([
    { id: s.host, frame: { code: "ROOM_EXPIRED" }, close: true },
  ]);
});
