import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES, parseClientMessage, PROTOCOL_VERSION } from "./index.ts";

describe("bootstrap protocol validation", () => {
  it("accepts a supported peer and ping without trusting unknown fields", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ type: "HELLO", version: PROTOCOL_VERSION, role: "host" }),
      ),
    ).toEqual({ type: "HELLO", version: PROTOCOL_VERSION, role: "host" });
    expect(parseClientMessage('{"type":"PING","id":3}')).toEqual({ type: "PING", id: 3 });
    expect(parseClientMessage('{"type":"PING","id":3,"admin":true}')).toBeUndefined();
  });

  it.each([
    "not json",
    "null",
    "[]",
    '{"type":"HELLO","version":999,"role":"host"}',
    '{"type":"HELLO","version":1,"role":"admin"}',
    '{"type":"PING","id":-1}',
    '{"type":"PING","id":1.5}',
    '{"type":"PING","id":4294967296}',
  ])("rejects untrusted input: %s", (raw) => {
    expect(parseClientMessage(raw)).toBeUndefined();
  });

  it("accepts the size boundary and rejects an otherwise valid oversized message", () => {
    const message = '{"type":"PING","id":0}';
    const padded = message.padEnd(MAX_MESSAGE_BYTES, " ");
    expect(parseClientMessage(padded)).toEqual({ type: "PING", id: 0 });
    expect(parseClientMessage(`${padded} `)).toBeUndefined();
  });
});
