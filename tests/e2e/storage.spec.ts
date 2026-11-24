import { GhostRecorder } from "../../apps/web/src/storage/ghost.ts";
import { build } from "vite";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createRace } from "../../packages/game-core/src/race.ts";
import { freshData, summarize, type Summary } from "../../apps/web/src/storage/model.ts";
import type { ProgressStore } from "../../apps/web/src/storage/database.ts";
declare global {
  interface Window {
    f10: ProgressStore;
  }
}
let code = "";
test.beforeAll(async () => {
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: { entry: resolve("apps/web/src/storage/database.ts"), formats: ["es"] },
    },
  })) as
    | { output: { type: string; code?: string }[] }
    | { output: { type: string; code?: string }[] }[];
  const bundle = Array.isArray(result) ? result[0] : result;
  code = bundle?.output.find((item) => item.type === "chunk")?.code ?? "";
  if (!code) throw new Error("Missing storage harness bundle");
});
async function boot(page: Page) {
  await page.route("**/f10-storage-harness.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: code }),
  );
  await page.evaluate(async () => {
    const url = "/f10-storage-harness.js";
    window.f10 = (await import(url)).progressStore;
    await window.f10.ready;
  });
}
async function seed(page: Page, value: unknown, version = 2) {
  await page.goto("/controller/");
  await page.evaluate(
    ({ value, version }) =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open("qracer.progress", version);
        req.onupgradeneeded = () => {
          for (const name of version === 1 ? ["state"] : ["state", "ghosts", "quarantine"])
            req.result.createObjectStore(name);
        };
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(value, "profile");
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    { value, version },
  );
}
const row = (id: string): Summary =>
  summarize(id, {
    ...createRace(),
    phase: "finished",
    score: 1200,
    driver: { ...createRace().driver, s: 1000 },
  });

test("migrates native IndexedDB, serializes two tabs and restores progress after reopening", async ({
  page,
  context,
}) => {
  const old = { ...freshData().progress, distance: 1500 };
  await seed(page, old, 1);
  await boot(page);
  expect(await page.evaluate(() => window.f10.data.progress.distance)).toBe(1500);
  await page.evaluate(async (row) => {
    await Promise.all([window.f10.commit(row), window.f10.commit(row)]);
  }, row("once"));
  const other = await context.newPage();
  await other.goto("/controller/");
  await boot(other);
  await Promise.all([
    page.evaluate((row) => window.f10.commit(row), row("one-tab")),
    other.evaluate((row) => window.f10.commit(row), row("other-tab")),
  ]);
  await other.close();
  await page.goto("/play/");
  await expect(page.locator("#app")).toHaveAttribute("data-storage", "saved");
  expect(await page.locator("#run-paint option[value='1']").isDisabled()).toBe(false);
  await page.goto("/controller/");
  await boot(page);
  expect(await page.evaluate(() => window.f10.data.progress.distance)).toBe(4500);
  expect(await page.evaluate(() => window.f10.data.history.length)).toBe(3);
});

test("quarantines corrupt data and preserves future schemas without overwriting them", async ({
  page,
  browser,
}) => {
  const broken = { ...freshData(), progress: { ...freshData().progress, distance: "broken" } };
  await seed(page, broken);
  await boot(page);
  expect(await page.evaluate(() => window.f10.status)).toBe("corrupt");
  expect(await page.evaluate(() => window.f10.backup)).toEqual(broken);
  await page.evaluate((row) => window.f10.commit(row), row("recovered"));
  expect(await page.evaluate(() => window.f10.status)).toBe("saved");
  const future = await browser.newPage();
  try {
    const data = { schemaVersion: 3, newField: "preserve" };
    await seed(future, data, 3);
    await boot(future);
    expect(await future.evaluate(() => window.f10.status)).toBe("future");
    await future.evaluate((row) => window.f10.commit(row), row("memory"));
    expect(await future.evaluate(() => window.f10.backup)).toEqual(data);
    expect(await future.evaluate(() => window.f10.status)).toBe("future");
    expect(await future.evaluate(() => window.f10.data.progress.distance)).toBe(1000);
  } finally {
    await future.close();
  }
});

test("evicts optional ghosts on quota and continues in memory if retry cannot persist", async ({
  page,
}) => {
  await seed(page, freshData());
  await boot(page);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const req = indexedDB.open("qracer.progress");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("ghosts", "readwrite");
          tx.objectStore("ghosts").put({ optional: true }, "old");
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
  );
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let first = true;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "state" && first) {
        first = false;
        throw new DOMException("full", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await page.evaluate((row) => window.f10.commit(row), row("retried"));
  expect(await page.evaluate(() => window.f10.status)).toBe("saved");
  expect(
    await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const req = indexedDB.open("qracer.progress");
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("ghosts");
            const count = tx.objectStore("ghosts").count();
            count.onsuccess = () => done(count.result);
            tx.oncomplete = () => db.close();
          };
        }),
    ),
  ).toBe(0);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "state") throw new DOMException("full", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.evaluate((row) => window.f10.commit(row), row("memory"));
  expect(await page.evaluate(() => window.f10.status)).toBe("memory");
  expect(await page.evaluate(() => window.f10.data.progress.distance)).toBe(2000);
});

test("keeps a run functional when access to IndexedDB is denied", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    }),
  );
  await page.goto("/controller/");
  await boot(page);
  expect(await page.evaluate(() => window.f10.status)).toBe("memory");
  await page.evaluate((row) => window.f10.commit(row), row("denied"));
  expect(await page.evaluate(() => window.f10.data.progress.distance)).toBe(1000);
});

test("retains ten category best ghosts atomically and isolates damaged optional replays", async ({
  page,
}) => {
  await seed(page, freshData());
  await boot(page);
  const fixture = (seedValue: number, score: number, id: string, meters = 4) => {
    const start = createRace(seedValue, undefined, { mode: "time-trial" });
    const finish = {
      ...start,
      phase: "finished" as const,
      tick: 3,
      score,
      driver: { ...start.driver, s: meters },
    };
    const result = summarize(id, finish);
    const recorder = new GhostRecorder(7200);
    recorder.capture({ ...start, phase: "racing" });
    const ghost = recorder.finish(finish, result.ended);
    if (!ghost) throw new Error("Missing ghost fixture");
    const { buffer, ...meta } = ghost;
    return { row: result, meta, bytes: Array.from(new Uint8Array(buffer)) };
  };
  const fixtures = Array.from({ length: 12 }, (_, i) => fixture(i, 1000 + i, `g-${i}`));
  const latest = fixtures[11];
  if (!latest) throw new Error("Missing final fixture");
  latest.row.ended = 0;
  latest.meta.ended = 0;
  await page.evaluate(async (rows) => {
    for (const { row, meta, bytes } of rows)
      await window.f10.commit(row, { ...meta, buffer: new Uint8Array(bytes).buffer });
  }, fixtures);
  expect(
    await page.evaluate(
      async (category) => (await window.f10.ghost(category))?.at(3)?.s,
      fixtures[0]?.row.category ?? "",
    ),
  ).toBeUndefined();
  for (const next of [fixture(11, 1, "worse", 99), fixture(11, 99999, "g-11", 100)]) {
    await page.evaluate(
      ({ row, meta, bytes }) =>
        window.f10.commit(row, { ...meta, buffer: new Uint8Array(bytes).buffer }),
      next,
    );
    expect(
      await page.evaluate(
        async (category) => (await window.f10.ghost(category))?.at(3)?.s,
        latest.row.category,
      ),
    ).toBe(4);
  }
  expect(
    await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const req = indexedDB.open("qracer.progress");
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("ghosts");
            const count = tx.objectStore("ghosts").count();
            count.onsuccess = () => done(count.result);
            tx.oncomplete = () => db.close();
          };
        }),
    ),
  ).toBe(10);
  await page.evaluate(
    (category) =>
      new Promise<void>((done) => {
        const req = indexedDB.open("qracer.progress");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("ghosts", "readwrite");
          tx.objectStore("ghosts").put(
            { schemaVersion: 1, category, score: 1011, ended: 0, buffer: new ArrayBuffer(4) },
            category,
          );
          tx.oncomplete = () => {
            db.close();
            done();
          };
        };
      }),
    latest.row.category,
  );
  expect(
    await page.evaluate(
      async (category) => (await window.f10.ghost(category))?.at(3),
      latest.row.category,
    ),
  ).toBeUndefined();
  expect(
    await page.evaluate(
      (category) => window.f10.data.progress.records[category],
      latest.row.category,
    ),
  ).toBe(1011);
});
