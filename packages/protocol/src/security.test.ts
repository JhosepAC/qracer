import { expect, it } from "vitest";
import { securityHeaders, securityOrigins } from "./security.ts";

it("rejects credentials, paths, wildcards, non-HTTP and directive injection in origins", () => {
  for (const origin of [
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com/",
    "*",
    "https://*.example.com",
    "https://example.com;script-src",
    "null",
    "data:text/html,x",
    "https://good.example; script-src *",
    "https://good.example\r\nX-Test: yes",
  ])
    expect(() => securityOrigins([origin])).toThrow();
  expect(() => securityOrigins({ origin: "https://example.com" })).toThrow();
  expect(securityOrigins(["https://example.com", "https://example.com"])).toEqual([
    "https://example.com",
  ]);
});
it("allows only the configured relay and required decoder capabilities", () => {
  const policy = securityHeaders("/play/", ["https://relay.example"]);
  expect(policy["Content-Security-Policy"]).toContain("https://relay.example wss://relay.example");
  expect(policy["Content-Security-Policy"]).toContain("'wasm-unsafe-eval'");
  expect(policy["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  expect(policy["Content-Security-Policy"]).not.toContain("'unsafe-inline'");
  expect(policy["Permissions-Policy"]).toContain("camera=()");
  expect(policy["Permissions-Policy"]).toContain("gyroscope=()");
});
it("limits sensors and wake lock to controller documents", () => {
  for (const path of ["/controller/", "/probe/controller/index.html"])
    expect(securityHeaders(path)["Permissions-Policy"]).toContain("gyroscope=(self)");
  for (const path of ["/play/", "/probe/", "/controller-other/"])
    expect(securityHeaders(path)["Permissions-Policy"]).toContain("gyroscope=()");
});

it("keeps dynamic invokers confined to a decoder worker without network access", () => {
  const worker = securityHeaders("/decoder-worker.js")["Content-Security-Policy"];
  expect(worker).toContain("'unsafe-eval'");
  expect(worker).toContain("connect-src 'none'");
  expect(worker).toContain("worker-src 'none'");
  for (const path of ["/", "/play/", "/controller/", "/decoder-worker.js-other"])
    expect(securityHeaders(path)["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
});
