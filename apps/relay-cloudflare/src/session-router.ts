import { equalToken } from "@qracer/probe";
import { createRoom } from "@qracer/session-core";
import { budget, type SessionEnv } from "./session-room.ts";

export async function routeSession(
  request: Request,
  env: SessionEnv,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path !== "/session" && !path.startsWith("/session/ws/")) return;
  if (!env.SESSIONS || !env.SESSION_BUDGET || !env.SESSION_ORIGINS)
    return new Response("Unavailable", { status: 404 });
  const origin = request.headers.get("Origin") ?? "";
  const secure =
    origin.startsWith("https://") ||
    (env.LOCAL_DIAGNOSTICS === "true" && origin.startsWith("http://127.0.0.1:"));
  if (!secure || !env.SESSION_ORIGINS.split(",").includes(origin))
    return new Response("Forbidden", { status: 403 });
  const headers = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (path === "/session") {
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Authorization",
        },
      });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers });
    if (
      env.SESSION_KEY &&
      !equalToken(
        request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
        env.SESSION_KEY,
      )
    )
      return new Response("Forbidden", { status: 403, headers });
    const now = Date.now();
    const { state, creation } = await createRoom(now);
    const quota = budget(env);
    try {
      const until = await quota.reserve(state.id, 0);
      if (!until)
        return Response.json(
          { type: "ERROR", code: "QUOTA_EXHAUSTED" },
          {
            status: 429,
            headers: { ...headers, "Retry-After": "30" },
          },
        );
      state.leaseUntil = until;
      await env.SESSIONS.getByName(state.id).initialize(state);
      return Response.json(creation, { status: 201, headers });
    } catch {
      try {
        await quota.release(state.id);
      } catch {
        /* The reservation expires. */
      }
      return new Response("Unavailable", { status: 503, headers });
    }
  }
  const id = /^\/session\/ws\/([a-f0-9]{32})$/.exec(path)?.[1];
  // Filter ordinary HTTP requests before addressing a room.
  if (
    id &&
    request.method === "GET" &&
    request.headers.get("Upgrade")?.toLowerCase() === "websocket"
  )
    return env.SESSIONS.getByName(id).fetch(request);
  return new Response("Not found", { status: 404 });
}
