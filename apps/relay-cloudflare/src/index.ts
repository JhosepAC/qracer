import { DurableObject } from "cloudflare:workers";
import { health } from "@qracer/protocol";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LOCAL_DIAGNOSTICS: string;
}

/** SQLite-backed skeleton; authorization/hibernating sockets are implemented in F04. */
export class Room extends DurableObject<Env> {
  override async fetch(): Promise<Response> {
    const row = this.ctx.storage.sql.exec<{ ready: number }>("SELECT 1 AS ready").one();
    return Response.json({
      ...health(),
      storage: row.ready === 1 ? "sqlite-ready" : "unavailable",
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const path = new URL(request.url).pathname;
    if (path === "/health")
      return Response.json(health(), { headers: { "Cache-Control": "no-store" } });
    // Not a public room-creation API: enabled only by the local emulator environment.
    if (env.LOCAL_DIAGNOSTICS === "true" && path === "/_local/room-health") {
      return env.ROOMS.get(env.ROOMS.idFromName("bootstrap-check")).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
