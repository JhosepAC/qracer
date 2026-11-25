import { DurableObject } from "cloudflare:workers";
import { health } from "@qracer/protocol";
import { securityHeaders } from "@qracer/protocol/security";
import type { ProbeEnv } from "./probe-room.ts";
import { routeProbe } from "./probe-router.ts";
import type { SessionEnv } from "./session-room.ts";
import { routeSession } from "./session-router.ts";

export { ProbeRoom } from "./probe-room.ts";
export { SessionBudget } from "./session-budget.ts";
export { SessionRoom } from "./session-room.ts";

interface Env extends ProbeEnv, SessionEnv {
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

async function route(request: Request, env: Env): Promise<Response> {
  const probe = await routeProbe(request, env);
  if (probe) return probe;
  const session = await routeSession(request, env);
  if (session) return session;
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const path = new URL(request.url).pathname;
  if (path === "/health")
    return Response.json(health(), { headers: { "Cache-Control": "no-store" } });
  // Not a public room-creation API: enabled only by the local emulator environment.
  if (env.LOCAL_DIAGNOSTICS === "true" && path === "/_local/room-health") {
    return env.ROOMS.get(env.ROOMS.idFromName("bootstrap-check")).fetch(request);
  }
  return new Response("Not found", { status: 404 });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await route(request, env);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders("/"))) headers.set(name, value);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
