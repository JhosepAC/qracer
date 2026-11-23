import { DurableObject } from "cloudflare:workers";
import { LEASE_MS } from "@qracer/session-core/wire";

const DAY_MS = 86_400_000;
const MAX_ACTIVE = 8;
const MAX_BLOCKS = 25;

export class SessionBudget extends DurableObject {
  private tables() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, until INTEGER)");
    sql.exec("CREATE TABLE IF NOT EXISTS usage (day INTEGER PRIMARY KEY, blocks INTEGER)");
    return sql;
  }

  async reserve(id: string, previousUntil: number): Promise<number | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const day = Math.floor(now / DAY_MS);
      const sql = this.tables();
      const until = this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM slots WHERE until <= ?", now);
        sql.exec("DELETE FROM usage WHERE day <> ?", day);
        const slot = sql
          .exec<{ until: number }>("SELECT until FROM slots WHERE id = ?", id)
          .toArray()[0];
        const active = sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM slots")
          .one().count;
        const blocks =
          sql.exec<{ blocks: number }>("SELECT blocks FROM usage WHERE day = ?", day).toArray()[0]
            ?.blocks ?? 0;
        if (blocks >= MAX_BLOCKS || (!slot && active >= MAX_ACTIVE)) return null;
        if ((slot?.until ?? 0) !== previousUntil) return null;
        const expires = Math.max(now, previousUntil) + LEASE_MS;
        sql.exec("INSERT OR REPLACE INTO slots VALUES (?, ?)", id, expires);
        sql.exec("INSERT OR REPLACE INTO usage VALUES (?, ?)", day, blocks + 1);
        return expires;
      });
      await this.schedule();
      return until;
    });
  }

  async release(id: string) {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.tables().exec("DELETE FROM slots WHERE id = ?", id);
      await this.schedule();
    });
  }

  private async schedule() {
    const value = this.tables()
      .exec<{ next: number | null }>("SELECT MIN(until) AS next FROM slots")
      .one().next;
    if (value === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(value);
  }

  override async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.tables().exec("DELETE FROM slots WHERE until <= ?", Date.now());
      await this.schedule();
    });
  }
}
