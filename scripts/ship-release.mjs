import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildShipCommitSubject, requirePublicReleaseSummary } from "./release-summary.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const bumpMode = normalizeBumpMode(process.argv[2] || "patch");
const customMessage = process.argv.slice(3).join(" ").trim();

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main() {
  const currentBranch = runGit(["branch", "--show-current"]).trim();
  if (currentBranch !== "main") {
    throw new Error(`Ship must run from main. Current branch: ${currentBranch || "unknown"}`);
  }
  const releaseSummary = requirePublicReleaseSummary(customMessage);

  execNode(["scripts/bump-version.mjs", bumpMode]);
  const releaseVersion = readVersionFromManifest();
  execNode(["scripts/build-main.mjs"]);
  execNode(["scripts/build-dist.mjs"]);
  runGit(["add", "-A"]);

  if (!hasStagedChanges()) {
    console.log("Nothing to ship. Working tree has no staged source changes after build.");
    return;
  }

  const commitMessage = buildCommitMessage(releaseVersion, releaseSummary);
  runGit(["commit", "-m", commitMessage]);
  runGit(["push", "origin", "main"]);

  console.log(`Shipped Save Sora ${releaseVersion} to main with ${bumpMode} release hint.`);
}

function normalizeBumpMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "patch" || normalized === "minor" || normalized === "major") {
    return normalized;
  }
  throw new Error(`Unsupported ship mode "${value}". Use patch, minor, or major.`);
}

function buildCommitMessage(version, summary) {
  return buildShipCommitSubject(version, summary);
}

function readVersionFromManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return typeof manifest.version === "string" && manifest.version ? manifest.version : "0.0.0";
}

function hasStagedChanges() {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: repoRoot,
      stdio: "ignore"
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
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function execNode(args) {
  execFileSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}
