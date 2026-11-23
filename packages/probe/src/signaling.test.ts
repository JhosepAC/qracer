import { expect, it } from "vitest";
import { credentials, ProbeSession } from "./session.ts";

it("caps the whole signaling negotiation, including across hibernation", () => {
  const keys = credentials(0);
  let session = new ProbeSession({ credentials: keys, used: false, peers: [] });
  session.add("host", 0);
  session.handle("host", { type: "AUTH", role: "host", token: keys.hostToken }, 1);
  const signal = { type: "SIGNAL", kind: "description", payload: "x".repeat(12000) } as const;
  for (let i = 0; i < 5; i++) expect(session.handle("host", signal, i + 2).close).toBeUndefined();
  session = new ProbeSession(session.snapshot());
  expect(session.handle("host", signal, 8).close).toBe("Signaling budget exceeded");
});
