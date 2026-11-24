import { bounded, categoryInfo, object, type Summary } from "./model.ts";
import { readGhost, type Ghost } from "./ghost.ts";
interface Entry {
  category: string;
  ended: number;
  score: number;
}
export function queueGhost(
  tx: IDBTransaction,
  row: Summary,
  ghost: Ghost | undefined,
  best: boolean,
) {
  if (!best || !ghost || ghost.score !== row.score || !readGhost(ghost, row.category)) return;
  const state = tx.objectStore("state"),
    store = tx.objectStore("ghosts");
  const keys = store.getAllKeys(undefined, 101);
  keys.onsuccess = () => {
    const current = state.get("ghost-index");
    current.onsuccess = () => {
      const raw = current.result;
      const entries: Entry[] =
        object(raw) &&
        raw.schemaVersion === 1 &&
        Array.isArray(raw.entries) &&
        raw.entries.length <= 10
          ? raw.entries
              .filter(
                (v: unknown): v is Entry =>
                  object(v) &&
                  !!categoryInfo(v.category) &&
                  bounded(v.ended, 4102444800000) &&
                  bounded(v.score),
              )
              .map((v) => ({ category: v.category, ended: v.ended, score: v.score }))
          : [];
      const next = [
        { category: row.category, ended: row.ended, score: row.score },
        ...entries.filter((v) => v.category !== row.category),
      ].slice(0, 10);
      const keep = new Set(next.map((v) => v.category));
      if (keys.result.length > 100) store.clear();
      else
        for (const key of keys.result)
          if (typeof key !== "string" || !keep.has(key)) store.delete(key);
      store.put({ ...ghost, ended: row.ended }, row.category);
      state.put({ schemaVersion: 1, entries: next }, "ghost-index");
    };
  };
}
