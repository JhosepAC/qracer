import { spawnSync } from "node:child_process";

if (!process.env.CI) {
  const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
  if (git("rev-parse", "--is-inside-work-tree").status === 0) {
    const previous = git("config", "--get", "core.hooksPath").stdout.trim();
    if (previous && previous !== ".githooks") {
      console.warn("Existing hooksPath retained. Run commitlint explicitly before committing.");
    } else {
      const result = git("config", "--local", "core.hooksPath", ".githooks");
      if (result.status !== 0) throw new Error("Could not configure repository hooks");
      console.log("Conventional Commit hook installed for this repository.");
    }
  }
}
