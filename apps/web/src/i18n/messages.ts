import { english } from "./controller.ts";
import { playEnglish } from "./play.ts";

export type Locale = "es" | "en";
const messages = { ...english, ...playEnglish };
const dynamic: readonly [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Integridad (\d+\/\d+)$/, (m) => `Integrity ${m[1]}`],
  [/^(\d+) puntos$/, (m) => `${m[1]} points`],
  [/^Caduca en (\d+:\d{2})$/, (m) => `Expires in ${m[1]}`],
  [/^Récord local: (\d+)$/, (m) => `Local best: ${m[1]}`],
  [
    /^Pinturas nuevas: (.+)$/,
    (m) =>
      `New paints: ${m[1]
        ?.split(", ")
        .map((v) => translateText(v, "en"))
        .join(", ")}`,
  ],
  [/^([★○]) (.+)$/, (m) => `${m[1]} ${translateText(m[2] ?? "", "en")}`],
  [
    /^Reto recreativo del (\d{4}-\d{2}-\d{2}) UTC\. Misma semilla y reglas durante el día\. Sin clasificación global\.$/,
    (m) =>
      `Recreational challenge for ${m[1]} UTC. Same seed and rules all day. No global leaderboard.`,
  ],
  [/^Mando listo$/, () => "Controller ready"],
  [/^Suelta los controles$/, () => "Release the controls"],
  [/^Sincronizando$/, () => "Synchronizing"],
];

/** Exact UI phrases and anchored numeric templates; never substitute arbitrary substrings. */
export function translateText(source: string, locale: Locale): string {
  if (locale === "es") return source;
  const text = source.trim().replace(/\s+/g, " ");
  let translated = Object.hasOwn(messages, text) ? messages[text] : undefined;
  if (translated === undefined && text.includes(" · "))
    translated = text
      .split(" · ")
      .map((part) => translateText(part, locale))
      .join(" · ");
  if (translated === undefined) {
    for (const [pattern, format] of dynamic) {
      const match = text.match(pattern);
      if (match) {
        translated = format(match);
        break;
      }
    }
  }
  return translated === undefined
    ? source
    : `${source.match(/^\s*/)?.[0] ?? ""}${translated}${source.match(/\s*$/)?.[0] ?? ""}`;
}
