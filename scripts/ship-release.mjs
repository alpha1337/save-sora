import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const bumpMode = normalizeBumpMode(process.argv[2] || "patch");
const customMessage = process.argv.slice(3).join(" ").trim();

main();

function main() {
  const currentBranch = runGit(["branch", "--show-current"]).trim();
  if (currentBranch !== "main") {
    throw new Error(`Ship must run from main. Current branch: ${currentBranch || "unknown"}`);
  }

  execNode(["scripts/bump-version.mjs", bumpMode]);
  const releaseVersion = readVersionFromManifest();
  execNode(["scripts/build-dist.mjs"]);
  runGit(["add", "-A"]);

  if (!hasStagedChanges()) {
    console.log("Nothing to ship. Working tree has no staged source changes after build.");
    return;
  }

  const commitMessage = buildCommitMessage(bumpMode, releaseVersion, customMessage);
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

function buildCommitMessage(mode, version, customText) {
  const baseText = normalizeSummaryText(customText || buildDefaultSummary());
  const fallbackText = normalizeSummaryText(`release Save Sora ${version}`);
  const messageText = baseText || fallbackText;

  if (mode === "major") {
    return `major: ${messageText}`;
  }

  if (mode === "minor") {
    return `feat: ${messageText}`;
  }

  return `fix: ${messageText}`;
}

function buildDefaultSummary() {
  const changedFiles = runGit(["diff", "--cached", "--name-only"])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const labels = [];

  if (changedFiles.some((value) => value === "background.js" || value.startsWith("offscreen"))) {
    labels.push("updater and background runtime");
  }
  if (
    changedFiles.some(
      (value) =>
        value === "popup.html" ||
        value === "popup.css" ||
        value === "popup.js" ||
        value.startsWith("popup/"),
    )
  ) {
    labels.push("popup UI");
  }
  if (
    changedFiles.some(
      (value) =>
        value === "manifest.json" ||
        value === "package.json" ||
        value.startsWith("scripts/") ||
        value.startsWith(".github/"),
    )
  ) {
    labels.push("release automation");
  }
  if (changedFiles.some((value) => value.startsWith("assets/"))) {
    labels.push("packaged assets");
  }

  if (!labels.length) {
    return "update Save Sora";
  }

  if (labels.length === 1) {
    return `update ${labels[0]}`;
  }

  if (labels.length === 2) {
    return `update ${labels[0]} and ${labels[1]}`;
  }

  return `update ${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function normalizeSummaryText(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/, "");
  return normalized;
}

function readVersionFromManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return typeof manifest.version === "string" && manifest.version ? manifest.version : "0.0.0";
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
