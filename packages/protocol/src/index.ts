import { z } from "zod";
import { PROTOCOL_VERSION } from "./version.ts";

export { PROTOCOL_VERSION } from "./version.ts";
export const MAX_MESSAGE_BYTES = 1024;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("HELLO"),
    version: z.literal(PROTOCOL_VERSION),
    role: z.enum(["host", "controller"]),
  }),
  z.strictObject({ type: z.literal("PING"), id: z.number().int().nonnegative().max(0xffffffff) }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Health = { status: "ok"; protocolVersion: typeof PROTOCOL_VERSION };

export function health(): Health {
  return { status: "ok", protocolVersion: PROTOCOL_VERSION };
}

/** Bootstrap protocol only: pairing and credentials are added in F04. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) return undefined;
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
