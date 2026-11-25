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

it("rejects nested prototype keys, executable strings and UTF-8 overflow without changing clean data", () => {
  const original = exportProgress(freshData());
  const mutate = (change: (value: Record<string, unknown>) => void) => {
    const value = JSON.parse(original);
    change(value.data.progress);
    return JSON.stringify(value);
  };
  const hostile = [
    original.replace('"records": {}', '"records": {"__proto__":{"polluted":true}}'),
    original.replace(
      '"progress": {',
      '"progress": {"constructor":{"prototype":{"polluted":true}},',
    ),
    mutate((progress) => {
      progress.recent = ['<img src=x onerror="window.importedCode=true">'];
    }),
    mutate((progress) => {
      progress.records = { "javascript:alert(1)": 100 };
    }),
    mutate((progress) => {
      progress.recent = ["safe", "safe"];
    }),
    JSON.stringify({ app: "QRacer", formatVersion: 1, padding: "😀".repeat(300_000) }),
  ];
  for (const text of hostile) expect(() => parseProgress(text)).toThrow();
  expect(exportProgress(parseProgress(original))).toBe(original);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect("importedCode" in globalThis).toBe(false);
});
