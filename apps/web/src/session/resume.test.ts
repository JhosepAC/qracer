import { ROOM_MS } from "@qracer/session-core/wire";
import { expect, it } from "vitest";
import { parseResume } from "./resume.ts";

it("accepts only finite, bounded, unexpired tab credentials with exact fields", () => {
  const now = 1_000_000;
  const good = { room: "a".repeat(32), token: "b".repeat(64), until: now + 1000 };
  expect(parseResume(JSON.stringify(good), now)).toEqual(good);
  for (const value of [
    { ...good, until: now },
    { ...good, until: now + ROOM_MS + 1 },
    { ...good, until: null },
    { ...good, room: "javascript:bad" },
    { ...good, token: "short" },
    { ...good, extra: "secret" },
    { room: good.room, token: good.token },
    [good],
    null,
  ])
    expect(parseResume(JSON.stringify(value), now)).toBeUndefined();
  expect(parseResume("broken", now)).toBeUndefined();
  expect(parseResume("x".repeat(257), now)).toBeUndefined();
  expect(parseResume(JSON.stringify(good), good.until + 1)).toBeUndefined();
});
