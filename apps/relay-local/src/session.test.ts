// @ts-expect-error The same ESM harness also runs from the Worker smoke command.
import { exerciseSession } from "../../../scripts/session-smoke.mjs";
import { expect, it } from "vitest";
import { createRelay } from "./server.ts";

it("runs the session contract over Node WebSockets", async () => {
  const origin = "http://127.0.0.1:5173";
  const relay = createRelay({ allowedOrigins: [origin] });
  try {
    await new Promise<void>((done) => relay.server.listen(0, "127.0.0.1", done));
    const address = relay.server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const evidence = await exerciseSession(`http://127.0.0.1:${address.port}`, origin);
    expect(evidence.constructorRestarted).toBe(false);
  } finally {
    await relay.close();
  }
});
