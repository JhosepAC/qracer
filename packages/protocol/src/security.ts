/** Canonical origins only: configuration must never inject CSP directives or credentials. */
export function securityOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error("Invalid security origins");
  return [
    ...new Set(
      value.map((origin: unknown) => {
        if (typeof origin !== "string" || /[\s;'"*\\]/.test(origin))
          throw new Error("Invalid security origin");
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          throw new Error("Invalid security origin");
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.origin !== origin ||
          url.username ||
          url.password
        )
          throw new Error("Security origins must be canonical HTTP(S) origins");
        return origin;
      }),
    ),
  ];
}
export const deniedPermissions =
  "camera=(), microphone=(), geolocation=(), magnetometer=(), clipboard-read=()";
export function sensorPolicy(path: string) {
  const controller = /^\/(?:probe\/)?controller(?:\/|$)/.test(path);
  const scope = controller ? "(self)" : "()";
  return `accelerometer=${scope}, gyroscope=${scope}, screen-wake-lock=${scope}`;
}
export function securityHeaders(path: string, origins: unknown = []): Record<string, string> {
  if (path === "/decoder-worker.js")
    return {
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": `${deniedPermissions}, ${sensorPolicy(path)}`,
    };
  const connections = securityOrigins(origins).flatMap((origin) => [
    origin,
    origin.replace(/^http/, "ws"),
  ]);
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "media-src 'none'",
      `connect-src 'self' blob: ${connections.join(" ")}`.trim(),
      "worker-src 'self'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": `${deniedPermissions}, ${sensorPolicy(path)}`,
  };
}
