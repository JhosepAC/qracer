import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { LEASE_MS } from "../packages/session-core/src/wire.ts";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
const { SessionBudget } = await import("../apps/relay-cloudflare/src/session-budget.ts");
const { admissionGate, BLOCK_UNITS, BLOCK_GB_SECONDS, DAY_MS, MAX_BLOCKS } = await import(
  "../apps/relay-cloudflare/src/session-limits.ts"
);
const { routeSession } = await import("../apps/relay-cloudflare/src/session-router.ts");
const databases = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

// Real SQLite exercises schema, bound values and transactions. Only the runtime actor is stubbed.
function fixture(at = DAY_MS * 20 + 1000) {
  let now = at;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  let alarm = null;
  let serial = Promise.resolve();
  const sql = {
    exec(query, ...args) {
      const stmt = db.prepare(query);
      const rows = /^(SELECT|PRAGMA)/.test(query) ? stmt.all(...args) : [];
      if (!/^(SELECT|PRAGMA)/.test(query)) stmt.run(...args);
      return {
        toArray: () => rows,
        one: () => {
          expect(rows).toHaveLength(1);
          return rows[0];
        },
      };
    },
  };
  const budget = new SessionBudget(
    {
      blockConcurrencyWhile(work) {
        const result = serial.then(work);
        serial = result.catch(() => {});
        return result;
      },
      storage: {
        sql,
        transactionSync(work) {
          db.exec("BEGIN");
          try {
            const result = work();
            db.exec("COMMIT");
            return result;
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        },
        async setAlarm(value) {
          alarm = value;
        },
        async deleteAlarm() {
          alarm = null;
        },
      },
    },
    {},
  );
  return {
    budget,
    db,
    now: () => now,
    set: (value) => {
      now = value;
    },
    alarm: () => alarm,
  };
}

it("reserves worst-case traffic and duration within half of Free daily quotas", () => {
  expect(BLOCK_UNITS).toBe(12000);
  expect(MAX_BLOCKS).toBe(4);
  expect(MAX_BLOCKS * BLOCK_UNITS).toBeLessThanOrEqual(50000);
  expect(MAX_BLOCKS * BLOCK_GB_SECONDS).toBeLessThanOrEqual(6500);
});
it("serializes parallel reservations, rejects stale renewals and never refunds daily usage", async () => {
  const f = fixture();
  const reservations = await Promise.all(
    Array.from({ length: 8 }, (_, i) => f.budget.reserve(String(i), 0)),
  );
  expect(reservations.filter(Boolean)).toHaveLength(MAX_BLOCKS);
  expect(await f.budget.active("0")).toBe(true);
  expect(await f.budget.active("unknown")).toBe(false);
  await f.budget.release("0");
  await f.budget.release("0");
  expect(await f.budget.active("0")).toBe(false);
  expect(await f.budget.reserve("another", 0)).toBeNull();
  expect(await f.budget.reserve("1", 0)).toBeNull();
  expect(await f.budget.reserve("1", reservations[1])).toBeNull();
});
it("renews only the current lease and cleans expired slots and daily aggregates without further traffic", async () => {
  const f = fixture();
  const first = await f.budget.reserve("room", 0);
  expect(await f.budget.reserve("room", first - 1)).toBeNull();
  const next = await f.budget.reserve("room", first);
  expect(next).toBe(first + LEASE_MS);
  f.set(next);
  await f.budget.alarm();
  expect(await f.budget.active("room")).toBe(false);
  expect(f.alarm()).toBe(DAY_MS * 21);
  f.set(f.alarm());
  await f.budget.alarm();
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM usage").get().n).toBe(0);
  expect(f.alarm()).toBeNull();
  expect(await f.budget.reserve("new-day", 0)).toBe(f.now() + LEASE_MS);
});
it("charges UTC-spanning leases in both days and limits the following day's carry-over", async () => {
  const f = fixture(DAY_MS * 21 - 60_000);
  const until = await f.budget.reserve("carry", 0);
  expect(
    f.db
      .prepare("SELECT blocks FROM usage ORDER BY day")
      .all()
      .map((r) => r.blocks),
  ).toEqual([1, 1]);
  f.set(DAY_MS * 21);
  await f.budget.alarm();
  expect(await f.budget.active("carry")).toBe(true);
  for (let i = 0; i < MAX_BLOCKS - 1; i++)
    expect(await f.budget.reserve(`new-${i}`, 0)).not.toBeNull();
  expect(await f.budget.reserve("overflow", 0)).toBeNull();
  expect(await f.budget.reserve("carry", until)).toBeNull();
  f.set(DAY_MS * 23);
  await f.budget.alarm();
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM usage").get().n).toBe(0);
  expect(f.alarm()).toBeNull();
});
it("sheds bursts before persistence without retaining IP addresses or unbounded keys", () => {
  const admit = admissionGate();
  for (let i = 0; i < 12; i++) expect(admit("create", 100_000)).toBe(true);
  expect(admit("create", 100_000)).toBe(false);
  for (let i = 0; i < 96; i++) expect(admit("upgrade", 100_000)).toBe(true);
  expect(admit("upgrade", 100_000)).toBe(false);
  expect(admit("create", 160_000)).toBe(true);
});
it("rejects foreign origins, secret query parameters and unknown IDs before room activation, and fails closed", async () => {
  const activate = vi.fn();
  const quota = { active: vi.fn(async () => false), reserve: vi.fn(), release: vi.fn() };
  const env = {
    SESSION_ORIGINS: "https://game.example",
    SESSIONS: { getByName: activate },
    SESSION_BUDGET: { getByName: () => quota },
  };
  const request = (path, origin = "https://game.example") =>
    new Request(`https://relay.example${path}`, {
      headers: { Origin: origin, Upgrade: "websocket" },
    });
  const path = `/session/ws/${"a".repeat(32)}`;
  expect((await routeSession(request(path, "https://game.example.evil"), env)).status).toBe(403);
  expect((await routeSession(request(`${path}?token=must-not-be-in-url`), env)).status).toBe(404);
  expect(quota.active).not.toHaveBeenCalled();
  expect((await routeSession(request(path), env)).status).toBe(403);
  expect(activate).not.toHaveBeenCalled();
  quota.active.mockRejectedValue(new Error("private backend detail"));
  const failed = await routeSession(request(path), env);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("private");
});

it("denies creation before room initialization when exhausted, gated or disabled and releases failed initialization", async () => {
  const initialize = vi.fn(async () => {});
  const quota = { reserve: vi.fn(async () => null), release: vi.fn() };
  const env = {
    SESSION_ORIGINS: "https://game.example",
    SESSIONS: { getByName: () => ({ initialize }) },
    SESSION_BUDGET: { getByName: () => quota },
  };
  const request = () =>
    new Request("https://relay.example/session", {
      method: "POST",
      headers: { Origin: "https://game.example" },
    });
  expect((await routeSession(request(), { ...env, SESSION_KEY: "operator-only" })).status).toBe(
    403,
  );
  expect((await routeSession(request(), { ...env, SESSION_DISABLED: "true" })).status).toBe(503);
  expect(quota.reserve).not.toHaveBeenCalled();
  const denied = await routeSession(request(), env);
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toBe("30");
  expect(initialize).not.toHaveBeenCalled();
  quota.reserve.mockResolvedValue(Date.now() + LEASE_MS);
  initialize.mockRejectedValue(new Error("sensitive initialization details"));
  const failed = await routeSession(request(), env);
  expect(failed.status).toBe(503);
  expect(await failed.text()).toBe("Unavailable");
  expect(quota.release).toHaveBeenCalledWith(quota.reserve.mock.calls.at(-1)[0]);
});
