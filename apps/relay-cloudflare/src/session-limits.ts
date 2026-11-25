import { LEASE_MS, MAX_PEER_MESSAGES, MAX_PEERS } from "@qracer/session-core/wire";
// Four peers at 50 inbound messages/s for 900s cost up to 9,000 request units.
// Reserve another 3,000 units for upgrades, coordinator RPCs and cleanup.
export const DAY_MS = 86_400_000;
export const MAX_ACTIVE = 8;
export const BLOCK_UNITS = (MAX_PEERS * MAX_PEER_MESSAGES * (LEASE_MS / 1000)) / 20 + 3000;
export const BLOCK_GB_SECONDS = 125;
export const MAX_BLOCKS = Math.min(
  Math.floor(50_000 / BLOCK_UNITS),
  Math.floor(6500 / BLOCK_GB_SECONDS),
);

/** Bounded per-isolate shedding, not a global quota or an IP identity store. */
export function admissionGate() {
  let windowAt = 0;
  let creates = 0;
  let upgrades = 0;
  return (kind: "create" | "upgrade", now: number) => {
    if (now - windowAt >= 60_000 || now < windowAt) {
      windowAt = now;
      creates = upgrades = 0;
    }
    return kind === "create" ? ++creates <= 12 : ++upgrades <= 96;
  };
}
