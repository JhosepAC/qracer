import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const { WebSocket } = createRequire(new URL("../apps/relay-local/package.json", import.meta.url))(
  "ws",
);
const { values } = parseArgs({
  options: {
    relay: { type: "string" },
    origin: { type: "string" },
    "key-file": { type: "string" },
    output: { type: "string", default: "artifacts/probe-soak" },
  },
});
function origin(raw) {
  if (!raw) throw new Error("Provide --relay and --origin explicitly");
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use an HTTP(S) origin without credentials or a path");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Public soak requires HTTPS");
  return url.origin;
}
const endpoint = origin(values.relay),
  frontend = origin(values.origin);
const key =
  process.env.QRACER_PROBE_KEY ??
  (values["key-file"]
    ? /^PROBE_KEY=([a-f0-9]{64})\r?$/m.exec(await readFile(values["key-file"], "utf8"))?.[1]
    : undefined);
if (!key || !/^[a-f0-9]{64}$/.test(key))
  throw new Error("Provide QRACER_PROBE_KEY or an ignored --key-file");
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const cancellation = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => cancellation.abort());
const response = await fetch(`${endpoint}/probe/session`, {
  method: "POST",
  redirect: "error",
  headers: { Origin: frontend, Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(10000),
});
if (response.status !== 201) throw new Error(`Session creation failed (${response.status})`);
const keys = await response.json();
if (
  !/^[a-f0-9]{32}$/.test(keys.id) ||
  ![keys.hostToken, keys.controllerToken].every((value) => /^[a-f0-9]{64}$/.test(value))
)
  throw new Error("Invalid relay response");
const began = performance.now(),
  startedUtc = new Date().toISOString();
const sockets = [],
  pending = new Map(),
  rtts = [],
  stats = [];
let phase = "connecting",
  sent = 0,
  received = 0,
  ping = 0,
  timeouts = 0,
  last = -1,
  gaps = 0,
  closed = 0,
  failure;
let control, echo, progress;
function fail(message) {
  failure = new Error(message);
  cancellation.abort();
}
function send(peer, message) {
  if (peer.readyState !== WebSocket.OPEN) return fail("Socket closed before completion");
  if (peer.bufferedAmount > 8192) return fail("Socket backpressure exceeded");
  try {
    peer.send(JSON.stringify(message));
  } catch {
    fail("Transport send failed");
  }
}
function connect(role) {
  return new Promise((done, reject) => {
    const peer = new WebSocket(`${endpoint.replace(/^http/, "ws")}/probe/ws/${keys.id}`, {
      origin: frontend,
      maxPayload: 16384,
      perMessageDeflate: false,
    });
    sockets.push(peer);
    const deadline = setTimeout(() => reject(new Error("Authentication timeout")), 10000);
    peer.on("open", () => send(peer, { type: "AUTH", role, token: keys[`${role}Token`] }));
    peer.on("error", () => {
      clearTimeout(deadline);
      reject(new Error("Transport failed"));
      fail("Transport failed");
    });
    peer.on("close", () => {
      clearTimeout(deadline);
      closed++;
      if (!["finished", "closing"].includes(phase)) fail("Unexpected disconnect");
    });
    peer.on("message", (raw, binary) => {
      if (binary) return fail("Unexpected binary frame");
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return fail("Invalid relay frame");
      }
      if (message.type === "READY") {
        clearTimeout(deadline);
        done(peer);
      }
      if (message.type === "INPUT" && role === "host") {
        received++;
        if (last >= 0) gaps += message.seq - last - 1;
        last = message.seq;
      }
      if (message.type === "STATS")
        stats.push({
          phase,
          received: message.received,
          bootId: typeof message.bootId === "string" ? message.bootId : null,
          at: new Date().toISOString(),
        });
      if (message.type === "ECHO" && !message.reply && role === "controller")
        send(peer, { ...message, reply: true });
      if (message.type === "ECHO" && message.reply && role === "host") {
        const time = pending.get(message.id);
        if (time !== undefined) {
          rtts.push(performance.now() - time);
          pending.delete(message.id);
        }
      }
    });
  });
}
const result = {
  experiment: "F02-public-WSS",
  startedUtc,
  complete: false,
  conditions: "Two Node clients on one PC through the configured relay; not physical phone data",
  activeTargetSeconds: 900,
  idleTargetSeconds: 120,
};
async function save() {
  const boots = stats.map((value) => value.bootId).filter(Boolean);
  const sorted = [...rtts].sort((a, b) => a - b);
  Object.assign(result, {
    endedUtc: new Date().toISOString(),
    phase,
    elapsedSeconds: (performance.now() - began) / 1000,
    sent,
    received,
    sequenceGaps: gaps,
    echoSamples: rtts.length,
    echoTimeouts: timeouts,
    closedBeforeCleanup: closed,
    stats,
    rttP50Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? null,
    rttP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    billing: "Application counters are not measured provider request units or GB-s",
    constructorRestarted: boots.length >= 2 ? boots[0] !== boots.at(-1) : null,
  });
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
}
try {
  const host = await connect("host"),
    controller = await connect("controller");
  phase = "active";
  let due = performance.now();
  function pump() {
    if (cancellation.signal.aborted) return;
    send(controller, {
      type: "INPUT",
      seq: ++sent,
      steer: Math.sin(sent / 90) * 0.7,
      throttle: 1,
      brake: 0,
    });
    due += 1000 / 30;
    control = setTimeout(pump, Math.max(0, due - performance.now()));
  }
  pump();
  echo = setInterval(() => {
    const id = ++ping;
    pending.set(id, performance.now());
    send(host, { type: "ECHO", id, reply: false });
    for (const [id, time] of pending)
      if (performance.now() - time > 5000) {
        pending.delete(id);
        timeouts++;
      }
  }, 1000);
  progress = setInterval(() => {
    void save();
    console.log(
      `WSS soak: ${Math.round((performance.now() - began) / 1000)} s, ${received} controls`,
    );
  }, 60000);
  await delay(900000, undefined, { signal: cancellation.signal });
  clearTimeout(control);
  clearInterval(echo);
  send(host, { type: "STATS" });
  phase = "idle";
  await save();
  await delay(120000, undefined, { signal: cancellation.signal });
  phase = "resumed";
  send(host, { type: "STATS" });
  const before = received;
  send(controller, { type: "INPUT", seq: ++sent, steer: 0, throttle: 0, brake: 0 });
  await delay(1000, undefined, { signal: cancellation.signal });
  if (received !== before + 1 || received !== sent || closed)
    throw new Error("Control or idle-resume verification failed");
  phase = "finished";
  result.complete = true;
} catch (error) {
  result.error = failure?.message ?? (cancellation.signal.aborted ? "Cancelled" : error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(control);
  clearInterval(echo);
  clearInterval(progress);
  await save();
  phase = "closing";
  for (const peer of sockets) peer.terminate();
  console.log(`Sanitized probe report saved; complete=${result.complete}`);
}
