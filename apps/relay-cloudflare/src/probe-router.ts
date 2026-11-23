import { equalToken } from "@qracer/probe";
import type { ProbeEnv } from "./probe-room.ts";

export async function routeProbe(request: Request, env: ProbeEnv): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/probe/")) return;
  if (!env.PROBES || !env.PROBE_KEY) return new Response("Disabled", { status: 404 });
  const origin = request.headers.get("Origin") ?? "";
  if (!env.PROBE_ORIGINS?.split(",").includes(origin))
    return new Response("Forbidden", { status: 403 });
  const headers = {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  if (path === "/probe/session") {
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
      !equalToken(
        request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "",
        env.PROBE_KEY,
      )
    )
      return new Response("Forbidden", { status: 403, headers });
    const keys = await env.PROBES.getByName("f02-admission").createExperiment();
    return keys
      ? Response.json(keys, { status: 201, headers })
      : new Response("Capacity reached", { status: 429, headers });
  }
  const id = /^\/probe\/ws\/([a-f0-9]{32})$/.exec(path)?.[1];
  if (id) return env.PROBES.getByName(id).fetch(request);
  return new Response("Not found", { status: 404 });
}
