import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { securityOrigins } from "@qracer/protocol/security";
/** Built relay origins are public configuration, loaded once rather than on every request. */
export async function builtOrigins(staticDir?: string): Promise<string[] | undefined> {
  if (!staticDir) return [];
  try {
    const text = await readFile(join(staticDir, "security-origins.json"), "utf8");
    if (text.length > 8192) return;
    return securityOrigins(JSON.parse(text));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    // Malformed configuration fails closed without echoing its contents to clients/logs.
    return;
  }
}
