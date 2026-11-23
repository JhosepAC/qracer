import { execFileSync } from "node:child_process";

export function validatePullRequest(changes) {
  const errors = [];
  if (changes.length > 12) errors.push(`PR changes ${changes.length} files; maximum is 12.`);
  const lines = changes
    .filter((change) => change.file !== "pnpm-lock.yaml")
    .reduce((sum, change) => sum + change.additions + change.deletions, 0);
  if (lines > 800)
    errors.push(`PR changes ${lines} source lines; split it into increments of at most 800.`);
  return errors;
}

if (import.meta.main) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const reference = process.argv[2] ?? "origin/main";
  const base = git("rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`);
  const ancestor = git("merge-base", base, "HEAD");
  const output = git("diff", "--numstat", ancestor, "HEAD");
  const changes = output
    ? output.split("\n").map((line) => {
        const [added, removed, ...path] = line.split("\t");
        return {
          file: path.join("\t"),
          additions: Number(added) || 0,
          deletions: Number(removed) || 0,
        };
      })
    : [];
  const errors = validatePullRequest(changes);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `PR scope accepted: ${changes.length}/12 files (generated lockfile excluded from source-line budget).`,
    );
}
