import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const semverPattern = /^\d+\.\d+\.\d+$/;

main();

function main() {
  const rawArgument = process.argv[2];
  const normalizedArgument = typeof rawArgument === "string" ? rawArgument.trim() : "";

  if (!normalizedArgument) {
    printUsageAndExit();
  }

  const manifest = readJson(manifestPath);
  const packageJson = readJson(packageJsonPath);
  const manifestVersion = normalizeVersion(manifest.version);
  const packageVersion = normalizeVersion(packageJson.version);

  if (!manifestVersion || !packageVersion) {
    throw new Error("manifest.json and package.json must both contain a valid x.y.z version.");
  }

  if (manifestVersion !== packageVersion) {
    throw new Error(
      `manifest.json (${manifestVersion}) and package.json (${packageVersion}) are out of sync.`,
    );
  }

  const nextVersion = resolveNextVersion(manifestVersion, normalizedArgument);
  manifest.version = nextVersion;
  packageJson.version = nextVersion;

  writeJson(manifestPath, manifest);
  writeJson(packageJsonPath, packageJson);

  console.log(`Updated Save Sora version: ${manifestVersion} -> ${nextVersion}`);
}

function resolveNextVersion(currentVersion, instruction) {
  if (semverPattern.test(instruction)) {
    return instruction;
  }

  const [major, minor, patch] = currentVersion.split(".").map((value) => Number.parseInt(value, 10));

  if (instruction === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }

  if (instruction === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  if (instruction === "major") {
    return `${major + 1}.0.0`;
  }

  throw new Error(
    `Unsupported version instruction "${instruction}". Use patch, minor, major, or an explicit x.y.z version.`,
  );
}

function normalizeVersion(value) {
  return typeof value === "string" && semverPattern.test(value.trim()) ? value.trim() : "";
}

function readJson(targetPath) {
  return JSON.parse(readFileSync(targetPath, "utf8"));
}

function writeJson(targetPath, value) {
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printUsageAndExit() {
  console.error("Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}
