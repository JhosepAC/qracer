import { execFileSync, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeProbeWorker, testProbeKey } from "./probe-worker.mjs";
import { exerciseSession } from "./session-smoke.mjs";

const cwd = fileURLToPath(new URL("../apps/relay-cloudflare/", import.meta.url));
for (const environment of ["local", "production"]) {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  const persistence = await mkdtemp(join(tmpdir(), "qracer-worker-"));
  const child = spawn(
    process.execPath,
    [
      join(cwd, "node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--env",
      environment,
      ...(environment === "local" ? ["--var", `PROBE_KEY:${testProbeKey}`] : []),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      persistence,
    ],
    {
      cwd,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-4000);
    });
  try {
    const deadline = Date.now() + 25000;
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        /* Wait for local workerd. */
      }
      if (ready) break;
      await new Promise((done) => setTimeout(done, 150));
    }
    if (!ready) throw new Error(`Worker failed to start: ${logs}`);
    const response = await fetch(`${origin}/_local/room-health`);
    if (environment === "local") {
      if ((await response.json()).storage !== "sqlite-ready")
        throw new Error("SQLite binding failed");
      await smokeProbeWorker(origin);
      const restored = await exerciseSession(origin, "http://127.0.0.1:8787", { idleMs: 12000 });
      if (!restored.constructorRestarted)
        throw new Error("Session constructor did not restart after idle");
      console.log("Session pairing, lease admission and restoration after hibernation passed.");
    } else {
      if (response.status !== 404) throw new Error("Production diagnostics must remain disabled");
      if ((await fetch(`${origin}/session`, { method: "POST" })).status !== 404)
        throw new Error("Production pairing requires an explicit origin configuration");
    }
    console.log(`Worker ${environment} smoke passed (local emulation only).`);
  } finally {
    if (child.exitCode === null) {
      if (process.platform === "win32")
        execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
      else process.kill(-child.pid, "SIGTERM");
    }
  }
}
