import { describe, expect, it } from "vitest";
import { validatePullRequest } from "./check-pr.mjs";

describe("review size policy", () => {
  const change = (file, additions = 1) => ({ file, additions, deletions: 0 });
  it("rejects a thirteenth file, even if all changes are small", () => {
    expect(
      validatePullRequest(Array.from({ length: 13 }, (_, i) => change(`${i}.ts`))),
    ).toHaveLength(1);
  });
  it("allows the exact source boundary and rejects excess source lines", () => {
    expect(validatePullRequest([change("source.ts", 800)])).toEqual([]);
    expect(validatePullRequest([change("source.ts", 801)])).toHaveLength(1);
  });
  it("counts a generated lockfile toward file count but not handwritten lines", () => {
    expect(validatePullRequest([change("pnpm-lock.yaml", 5000), change("source.ts", 40)])).toEqual(
      [],
    );
  });
});
