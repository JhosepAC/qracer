export type Route = "wss" | "rtc";
export type TransportFrame = { epoch: number } & (
  | { type: "SIGNAL"; kind: "offer" | "answer" | "candidate"; payload: string }
  | { type: "TRANSPORT_REQUEST" | "TRANSPORT_ACK" | "TRANSPORT_PROPOSE"; route: Route }
  | { type: "FALLBACK" | "HEARTBEAT" }
);

export const SIGNAL_BYTES = 16_384;
export const NEGOTIATION_BYTES = 65_536;

export function parseTransport(data: Record<string, unknown>): TransportFrame | undefined {
  const { epoch, type, route, kind, payload } = data;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) return;
  if (type === "FALLBACK" || type === "HEARTBEAT") return { type, epoch };
  if (
    (type === "TRANSPORT_REQUEST" || type === "TRANSPORT_ACK" || type === "TRANSPORT_PROPOSE") &&
    (route === "rtc" || route === "wss")
  )
    return { type, epoch, route };
  if (
    type === "SIGNAL" &&
    (kind === "offer" || kind === "answer" || kind === "candidate") &&
    typeof payload === "string" &&
    new TextEncoder().encode(payload).length <= 15_000
  )
    return { type, epoch, kind, payload };
}

export function isTransport(frame: { type: string }): frame is TransportFrame {
  return [
    "SIGNAL",
    "TRANSPORT_REQUEST",
    "TRANSPORT_ACK",
    "TRANSPORT_PROPOSE",
    "FALLBACK",
    "HEARTBEAT",
  ].includes(frame.type);
}
