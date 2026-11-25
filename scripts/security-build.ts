import type { Plugin } from "vite";
import {
  deniedPermissions,
  securityHeaders,
  securityOrigins,
  sensorPolicy,
} from "../packages/protocol/src/security.ts";
export function securityBuild(): Plugin {
  let origins: string[] = [];
  return {
    name: "qracer-security-headers",
    configResolved(config) {
      origins = securityOrigins(
        [config.env.VITE_SESSION_RELAY, config.env.VITE_PROBE_RELAY].filter(Boolean),
      );
    },
    generateBundle() {
      const headers = securityHeaders("/", origins);
      headers["Permissions-Policy"] = deniedPermissions;
      let text = `/*\n${Object.entries(headers)
        .map(([key, value]) => `  ${key}: ${value}`)
        .join("\n")}\n`;
      // Exact document routes avoid duplicate sensor directives in overlapping Pages rules.
      for (const route of ["/", "/play/", "/controller/", "/probe/", "/probe/controller/"])
        for (const path of route === "/"
          ? ["/", "/index.html"]
          : [route.slice(0, -1), route, `${route}index.html`])
          text += `\n${path}\n  Permissions-Policy: ${sensorPolicy(route)}\n`;
      // Pages combines matching CSP headers. Detach the document policy first,
      // then grant the isolated Basis worker no network or nested-worker access.
      text += `\n/decoder-worker.js\n  ! Content-Security-Policy\n  Content-Security-Policy: ${securityHeaders("/decoder-worker.js")["Content-Security-Policy"]}\n`;
      this.emitFile({ type: "asset", fileName: "_headers", source: text });
      this.emitFile({
        type: "asset",
        fileName: "security-origins.json",
        source: JSON.stringify(origins),
      });
    },
  };
}
