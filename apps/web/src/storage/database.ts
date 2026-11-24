import { queueGhost } from "./ghost-index.ts";
import { readGhost, type Ghost, type GhostPlayback } from "./ghost.ts";
import {
  addResult,
  DataFault,
  freshData,
  readData,
  type SaveData,
  type StorageStatus,
  type Summary,
} from "./model.ts";

export const DATABASE = "qracer.progress";
export const DB_VERSION = 2;
function openDatabase(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, version);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error("Storage blocked"));
    }, 2500);
    request.onupgradeneeded = () => {
      if (expired) {
        request.transaction?.abort();
        return;
      }
      for (const store of ["state", "ghosts", "quarantine"])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) request.result.close();
      else resolve(request.result);
    };
  });
}

/** No awaits inside IDB callbacks: read/modify/write belongs to one native transaction. */
export class ProgressStore {
  data = freshData();
  status: StorageStatus = "memory";
  backup: unknown;
  freeOptional: (() => Promise<void>) | undefined;
  flush() {
    return this.queue;
  }
  protected db: IDBDatabase | undefined;
  protected locked = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  readonly ready = this.load();
  subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  protected notify() {
    for (const listener of this.listeners) listener();
  }
  protected transaction<T>(
    write: boolean,
    apply: (tx: IDBTransaction, raw: unknown) => T,
    extraStores: string[] = [],
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) return reject(new Error("No database"));
      const stores = write ? ["state", "ghosts", "quarantine"] : ["state", ...extraStores];
      const tx = db.transaction(stores, write ? "readwrite" : "readonly");
      let output: T;
      let failure: unknown;
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {}
        reject(new Error("Storage timeout"));
      }, 5000);
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve(output);
      };
      tx.onabort = () => {
        clearTimeout(timer);
        reject(failure ?? tx.error ?? new Error("Storage failed"));
      };
      const request = tx.objectStore("state").get("profile");
      request.onsuccess = () => {
        try {
          output = apply(tx, request.result);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  private async load() {
    try {
      try {
        this.db = await openDatabase(DB_VERSION);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "VersionError") throw error;
        this.db = await openDatabase();
        this.locked = true;
      }
      this.db.onversionchange = () => {
        this.db?.close();
        this.db = undefined;
        this.status = "memory";
        this.notify();
      };
      this.data = await this.transaction(!this.locked, (tx, raw) => {
        this.backup = raw;
        if (this.locked) throw new DataFault("future");
        try {
          const data = readData(raw);
          if (raw !== undefined && (raw as { schemaVersion?: number }).schemaVersion === 1)
            tx.objectStore("state").put(data, "profile");
          this.status = "saved";
          this.backup = undefined;
          return data;
        } catch (error) {
          if (error instanceof DataFault && error.reason === "future") throw error;
          tx.objectStore("quarantine").put(raw, "profile");
          const data = freshData();
          tx.objectStore("state").put(data, "profile");
          this.status = "corrupt";
          return data;
        }
      });
    } catch (error) {
      this.status = error instanceof DataFault && error.reason === "future" ? "future" : "memory";
      this.locked = this.status === "future";
      if (!this.locked) {
        this.db?.close();
        this.db = undefined;
      }
    }
    this.notify();
  }
  protected serial<T>(action: () => Promise<T>) {
    const task = this.queue.then(() => this.ready).then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  replace(data: SaveData) {
    const validated = readData(data);
    return this.serial(async () => {
      if (this.locked) throw new DataFault("future");
      if (this.db)
        await this.transaction(true, (tx, raw) => {
          try {
            readData(raw);
          } catch (error) {
            if (error instanceof DataFault && error.reason === "future") throw error;
          }
          tx.objectStore("state").put(validated, "profile");
          tx.objectStore("ghosts").clear();
          tx.objectStore("state").delete("ghost-index");
          tx.objectStore("quarantine").clear();
        });
      this.data = validated;
      this.backup = undefined;
      this.status = this.db ? "saved" : "memory";
      this.notify();
    });
  }
  recovery() {
    if (this.backup !== undefined) return Promise.resolve(this.backup);
    const db = this.db;
    if (!db?.objectStoreNames.contains("quarantine")) return Promise.resolve(undefined);
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("quarantine");
      const req = tx.objectStore("quarantine").get("profile");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  reset() {
    return this.serial(async () => {
      this.db?.close();
      this.db = undefined;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DATABASE);
        const timer = setTimeout(() => reject(new Error("Storage blocked")), 2500);
        req.onsuccess = () => {
          clearTimeout(timer);
          resolve();
        };
        req.onerror = () => {
          clearTimeout(timer);
          reject(req.error);
        };
      });
      this.locked = false;
      this.backup = undefined;
      this.data = freshData();
      await this.load();
    });
  }
  ghost(category: string): Promise<GhostPlayback | undefined> {
    return this.serial(async () => {
      if (!this.db || this.locked) return;
      let playback: GhostPlayback | undefined;
      try {
        await this.transaction(
          false,
          (tx, raw) => {
            const profile = readData(raw);
            const req = tx.objectStore("ghosts").get(category);
            req.onsuccess = () => {
              const value = req.result;
              if (value?.score === profile.progress.records[category])
                playback = readGhost(value, category);
            };
          },
          ["ghosts"],
        );
      } catch {
        return;
      }
      return playback;
    });
  }
  commit(row: Summary, ghost?: Ghost): Promise<SaveData> {
    return this.serial(async () => {
      const memory = addResult(this.data, row);
      if (this.db && !this.locked) {
        const write = (includeGhost = true) =>
          this.transaction(true, (tx, raw) => {
            const before = readData(raw);
            const next = addResult(before, row);
            if (includeGhost && next !== before)
              queueGhost(
                tx,
                row,
                ghost,
                row.mode !== "practice" &&
                  row.score > (before.progress.records[row.category] ?? -1),
              );
            tx.objectStore("state").put(next, "profile");
            return next;
          });
        try {
          this.data = await write();
          this.status = "saved";
        } catch (error) {
          if (error instanceof DOMException && error.name === "QuotaExceededError") {
            try {
              await this.freeOptional?.().catch(() => undefined);
              await this.transaction(true, (tx) => {
                tx.objectStore("ghosts").clear();
                tx.objectStore("state").delete("ghost-index");
              });
              this.data = await write(false);
              this.status = "saved";
              this.notify();
              return this.data;
            } catch {
              /* Memory remains the authoritative fallback for this tab. */
            }
          }
          if (error instanceof DataFault && error.reason === "future") {
            this.locked = true;
            this.status = "future";
          } else {
            this.db?.close();
            this.db = undefined;
            this.status = "memory";
          }
          this.data = memory;
        }
      } else this.data = memory;
      this.notify();
      return this.data;
    });
  }
}
export const progressStore = new ProgressStore();
