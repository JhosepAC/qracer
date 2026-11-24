import { expect, it } from "vitest";
import { translateText } from "./messages.ts";

it("localizes anchored dynamic UI messages and preserves data and source spacing", () => {
  expect(translateText("  Integridad 2/3 ", "en")).toBe("  Integrity 2/3 ");
  expect(translateText("Práctica · Costa · Combo ×2", "en")).toBe("Practice · Coast · Combo ×2");
  expect(translateText("○ Adelantamientos limpios · 2 / 10", "en")).toBe(
    "○ Clean overtakes · 2 / 10",
  );
  expect(translateText("Pinturas nuevas: Glaciar, Violeta", "en")).toBe(
    "New paints: Glacier, Violet",
  );
  expect(translateText("https://qracer.test/#invite=Glaciar", "en")).toBe(
    "https://qracer.test/#invite=Glaciar",
  );
  expect(translateText("<img onerror=alert(1)>", "en")).toBe("<img onerror=alert(1)>");
  expect(translateText("Integridad 2/3", "es")).toBe("Integridad 2/3");
});

it("preserves unknown text even when it names inherited object properties", () => {
  for (const source of ["constructor", "toString", "__proto__", "hasOwnProperty"])
    expect(translateText(source, "en")).toBe(source);
});
