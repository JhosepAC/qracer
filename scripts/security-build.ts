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
      const publicKeys = new Set(["VITE_SESSION_RELAY", "VITE_PROBE_RELAY"]);
      if (Object.keys(config.env).some((key) => key.startsWith("VITE_") && !publicKeys.has(key)))
        throw new Error("Unreviewed public environment variable");
      if (
        Object.keys(config.define ?? {}).some(
          (key) => key === "process.env" || key === "import.meta.env",
        )
      )
        throw new Error("Whole environment substitution is forbidden");
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
      for (const route of [
        "/",
        "/play/",
        "/controller/",
        "/privacy/",
        "/probe/",
        "/probe/controller/",
      ])
        for (const path of route === "/"
          ? ["/", "/index.html"]
          : [route.slice(0, -1), route, `${route}index.html`])
          text += `\n${path}\n  Permissions-Policy: ${sensorPolicy(route)}\n`;
      // Pages combines matching CSP headers. Detach the document policy first,
      // then grant the isolated Basis worker no network or nested-worker access.
      text += `\n/decoder-worker.js\n  ! Content-Security-Policy\n  Content-Security-Policy: ${securityHeaders("/decoder-worker.js")["Content-Security-Policy"]}\n`;
      if (text.split("\n").some((line) => line.length > 2000))
        throw new Error("Security header exceeds the Pages line limit");
      this.emitFile({ type: "asset", fileName: "_headers", source: text });
      this.emitFile({
        type: "asset",
        fileName: "security-origins.json",
        source: JSON.stringify(origins),
      });
    },
  };
}
