import { fileURLToPath } from "node:url";
import { createRelay } from "./server.ts";

const port = Number(process.env.QRACER_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid QRACER_PORT");
const host = process.env.QRACER_HOST ?? "127.0.0.1";
const relay = createRelay({
  ...(process.env.QRACER_PROBE_KEY ? { probeKey: process.env.QRACER_PROBE_KEY } : {}),
  staticDir: fileURLToPath(new URL("../../web/dist/", import.meta.url)),
  allowedOrigins: (
    process.env.QRACER_ALLOWED_ORIGINS ??
    `http://127.0.0.1:${port},http://localhost:${port},http://127.0.0.1:5173`
  ).split(","),
});
relay.server.listen(port, host, () => console.log(`QRacer: http://${host}:${port}/play/`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void relay.close();
  });
}
