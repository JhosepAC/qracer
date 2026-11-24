import { createRace, stepRace } from "../packages/game-core/src/race.ts";
import { openLane } from "../packages/game-core/src/traffic.ts";
import { GhostRecorder } from "../apps/web/src/storage/ghost.ts";
import { freshData } from "../apps/web/src/storage/model.ts";

/** Synthetic offset comparison lane, derived from actual fixed-step motion; never a player record. */
export async function seedBenchmarkGhost(page, origin, seconds) {
  let race = createRace(310, undefined, { mode: "time-trial" });
  const recorder = new GhostRecorder(7200);
  const lane = openLane(310);
  const steer = lane === 1 ? 0 : lane === 0 ? -1 : 1;
  const boostAt = (seconds / 2 - 3) * 60;
  while (race.phase !== "finished") {
    race = stepRace(race, {
      steer,
      throttle: 1,
      brake: 0,
      boost: race.tick >= boostAt && race.tick < boostAt + 120,
    });
    recorder.capture({
      ...race,
      driver: {
        ...race.driver,
        d: lane === 1 ? 3 : -race.driver.d,
        lateral: lane === 1 ? 0 : -race.driver.lateral,
      },
    });
  }
  if (race.tick !== 7200) throw new Error("Benchmark fixture ended early");
  const ghost = recorder.finish(race);
  if (!ghost) throw new Error("Missing benchmark ghost");
  const { buffer, ...meta } = ghost;
  const profile = freshData();
  profile.progress = { ...profile.progress, records: { [ghost.category]: ghost.score } };
  await page.goto(`${origin}/health`);
  await page.evaluate(
    ({ profile, meta, bytes }) =>
      new Promise((done, reject) => {
        const request = indexedDB.open("qracer.progress", 2);
        request.onupgradeneeded = () => {
          for (const name of ["state", "ghosts", "quarantine"])
            request.result.createObjectStore(name);
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["state", "ghosts"], "readwrite");
          tx.objectStore("state").put(profile, "profile");
          tx.objectStore("ghosts").put(
            { ...meta, buffer: Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)).buffer },
            meta.category,
          );
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { profile, meta, bytes: Buffer.from(buffer).toString("base64") },
  );
}
