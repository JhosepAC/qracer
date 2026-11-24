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
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) return reject(new Error("No database"));
      const stores = write ? ["state", "ghosts", "quarantine"] : ["state"];
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
  commit(row: Summary): Promise<SaveData> {
    return this.serial(async () => {
      const memory = addResult(this.data, row);
      if (this.db && !this.locked) {
        const write = () =>
          this.transaction(true, (tx, raw) => {
            const next = addResult(readData(raw), row);
            tx.objectStore("state").put(next, "profile");
            return next;
          });
        try {
          this.data = await write();
          this.status = "saved";
        } catch (error) {
          if (error instanceof DOMException && error.name === "QuotaExceededError") {
            try {
              await this.transaction(true, (tx) => {
                tx.objectStore("ghosts").clear();
              });
              this.data = await write();
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
