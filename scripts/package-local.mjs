import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBudgets } from "./check-budgets.mjs";
import { writeLicenses } from "./licenses.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await checkBudgets(join(root, "apps/web/dist"));
const notices = await writeLicenses();
const output = join(root, "artifacts");
await mkdir(output, { recursive: true });
const stage = await mkdtemp(join(output, "local-"));
await cp(join(root, "apps/web/dist"), join(stage, "web"), {
  recursive: true,
  filter: (source) =>
    !source.includes(`${join("dist", ".vite")}`) && !source.endsWith("bundle-report.json"),
});
await cp(join(root, "apps/relay-local/dist/server.mjs"), join(stage, "server.mjs"));
await cp(join(root, "LICENSE"), join(stage, "LICENSE"));
await cp(join(notices, "THIRD_PARTY_NOTICES.txt"), join(stage, "THIRD_PARTY_NOTICES.txt"));
await writeFile(
  join(stage, "start.mjs"),
  `import { createRelay } from './server.mjs';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.QRACER_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid QRACER_PORT');
const host = process.env.QRACER_HOST ?? '127.0.0.1';
const origins = (process.env.QRACER_ALLOWED_ORIGINS ?? 'http://127.0.0.1:'+port+',http://localhost:'+port).split(',');
const relay = createRelay({ staticDir: fileURLToPath(new URL('./web/', import.meta.url)), allowedOrigins: origins });
relay.server.listen(port, host, () => console.log('QRacer: http://'+host+':'+port+'/play/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.close(); });
`,
);
await writeFile(
  join(stage, "README.txt"),
  [
    "QRacer local",
    "Requires Node 24.21.0 (no pnpm, Blender or node_modules).",
    "Run: node start.mjs",
    "Open http://127.0.0.1:3000/play/ and choose Salir a pista.",
    "Steer: A/D or Left/Right. Throttle/brake: W/S or Up/Down. Boost: Shift. Pause: Esc.",
    "Pair a phone from Connect mobile in /play/ on a trusted Wi-Fi network.",
    "Set QRACER_HOST to the PC LAN IP and QRACER_ALLOWED_ORIGINS to its exact HTTP origin before starting.",
    "Open that LAN URL on the PC to generate a scannable QR. Approve the matching code on the PC.",
    "After approval, choose Jugar con móvil on the PC. Touch works on LAN HTTP.",
    "Local data offers validated progress JSON import/export and separate progress/download/preferences deletion.",
    "Timed modes can display a compatible local ghost. Results offer a local PNG card.",
    "Offline keyboard play requires downloaded content on trusted HTTPS or localhost/127.0.0.1.",
    "Wait for the offline menu confirmation; download all environments to prepare desert and city.",
    "Updates wait until every PC tab returns to its menu. HTTP LAN stays online/tactile only.",
    "Tilt and wake lock require trusted HTTPS and a compatible browser. Sensor experiments: /probe/.",
    "Privacy notice in Spanish and English: /privacy/ (also available after preparing offline downloads).",
    "For trusted LAN use QRACER_HOST and QRACER_ALLOWED_ORIGINS explicitly. Sensors require trusted HTTPS.",
    "",
  ].join("\n"),
);
const archive = join(output, "qracer-local-0.1.0.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", stage, "."], { windowsHide: true });
const hash = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(`${archive}.sha256`, `${hash}  qracer-local-0.1.0.tar.gz\n`);
console.log(JSON.stringify({ archive, sha256: hash, stage }, null, 2));
