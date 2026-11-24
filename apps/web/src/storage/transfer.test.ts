import { expect, it } from "vitest";
import { freshData, MAX_IMPORT } from "./model.ts";
import { exportProgress, parseProgress } from "./transfer.ts";
it("roundtrips only the bounded progress schema, excluding ghosts and credentials", () => {
  const data = freshData();
  expect(parseProgress(exportProgress(data))).toEqual(data);
  expect(exportProgress(data)).not.toMatch(/token|ghost|sdp|orientation/i);
  for (const value of [
    '{"app":"QRacer","formatVersion":1}',
    '{"app":"QRacer","formatVersion":1,"data":null}',
    exportProgress(data).replace('"formatVersion": 1', '"formatVersion": 2'),
    JSON.stringify({ app: "QRacer", formatVersion: 1, data: { ...data, secret: "token" } }),
    '{"__proto__":{"polluted":true}}',
    "x".repeat(MAX_IMPORT + 1),
  ])
    expect(() => parseProgress(value)).toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
