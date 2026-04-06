import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const bumpMode = normalizeBumpMode(process.argv[2] || "patch");
const customMessage = process.argv.slice(3).join(" ").trim();

main();

function main() {
  const currentBranch = runGit(["branch", "--show-current"]).trim();
  if (currentBranch !== "main") {
    throw new Error(`Ship must run from main. Current branch: ${currentBranch || "unknown"}`);
  }

  execNode(["scripts/build-dist.mjs"]);
  runGit(["add", "-A"]);

  if (!hasStagedChanges()) {
    console.log("Nothing to ship. Working tree has no staged source changes after build.");
    return;
  }

  const commitMessage = buildCommitMessage(bumpMode, customMessage);
  runGit(["commit", "-m", commitMessage]);
  runGit(["push", "origin", "main"]);

  console.log(`Shipped to main with ${bumpMode} release hint.`);
}

function normalizeBumpMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "patch" || normalized === "minor" || normalized === "major") {
    return normalized;
  }
  throw new Error(`Unsupported ship mode "${value}". Use patch, minor, or major.`);
}

function buildCommitMessage(mode, customText) {
  const baseText = customText || "ship latest changes";

  if (mode === "major") {
    return `major: ${baseText}`;
  }

  if (mode === "minor") {
    return `feat: ${baseText}`;
  }

  return `chore: ${baseText}`;
}

function hasStagedChanges() {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return false;
  } catch (error) {
    if (error && typeof error.status === "number" && error.status === 1) {
      return true;
    }
    throw error;
  }
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function execNode(args) {
  execFileSync("node", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
