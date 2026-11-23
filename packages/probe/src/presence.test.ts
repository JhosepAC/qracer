import { expect, it } from "vitest";
import { credentials, ProbeSession } from "./session.ts";

it("closes control traffic after the host leaves instead of keeping an empty relay active", () => {
  const keys = credentials(0);
  const session = new ProbeSession({ credentials: keys, used: false, peers: [] });
  session.add("pc", 0);
  session.handle("pc", { type: "AUTH", role: "host", token: keys.hostToken }, 1);
  session.add("phone", 0);
  session.handle("phone", { type: "AUTH", role: "controller", token: keys.controllerToken }, 1);
  session.remove("pc");
  expect(
    session.handle("phone", { type: "INPUT", seq: 1, steer: 1, throttle: 1, brake: 0 }, 2).close,
  ).toBe("Host unavailable");
});
