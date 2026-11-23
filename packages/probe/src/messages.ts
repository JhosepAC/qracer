import { z } from "zod";

export const PROBE_MAX_BYTES = 16384;
const uint = z.number().int().min(0).max(0xffffffff);
const unit = z.number().min(0).max(1);
export const probeMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("AUTH"),
    role: z.enum(["host", "controller"]),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    type: z.literal("INPUT"),
    seq: uint,
    steer: z.number().min(-1).max(1),
    throttle: unit,
    brake: unit,
  }),
  z.strictObject({ type: z.literal("ECHO"), id: uint, reply: z.boolean() }),
  z.strictObject({
    type: z.literal("SIGNAL"),
    kind: z.enum(["description", "candidate"]),
    payload: z.string().max(12000),
  }),
  z.strictObject({ type: z.literal("STATS") }),
]);
export type ProbeMessage = z.infer<typeof probeMessageSchema>;
export type ProbeBody = Record<string, unknown>;
export type Effect = { to: string; body: ProbeBody };

export function parseProbeMessage(raw: string): ProbeMessage | undefined {
  if (new TextEncoder().encode(raw).byteLength > PROBE_MAX_BYTES) return;
  try {
    const parsed = probeMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
}

export function equalToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let index = 0; index < 64; index++)
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return diff === 0 && a.length === 64;
}
