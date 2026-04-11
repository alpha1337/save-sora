import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const v2ManifestPath = path.join(repoRoot, "v2", "manifest.json");
const legacyManifestPath = path.join(repoRoot, "manifest.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const semverPattern = /^\d+\.\d+\.\d+$/;

main();

function main() {
  const rawArgument = process.argv[2];
  const normalizedArgument = typeof rawArgument === "string" ? rawArgument.trim() : "";

  if (!normalizedArgument) {
    printUsageAndExit();
  }

  const v2Manifest = readJson(v2ManifestPath);
  const packageJson = readJson(packageJsonPath);
  const v2ManifestVersion = normalizeVersion(v2Manifest.version);
  const packageVersion = normalizeVersion(packageJson.version);

  if (!v2ManifestVersion || !packageVersion) {
    throw new Error("v2/manifest.json and package.json must both contain a valid x.y.z version.");
  }

  if (v2ManifestVersion !== packageVersion) {
    throw new Error(
      `v2/manifest.json (${v2ManifestVersion}) and package.json (${packageVersion}) are out of sync.`,
    );
  }

  const nextVersion = resolveNextVersion(v2ManifestVersion, normalizedArgument);
  v2Manifest.version = nextVersion;
  packageJson.version = nextVersion;

  writeJson(v2ManifestPath, v2Manifest);
  writeJson(packageJsonPath, packageJson);

  if (normalizeVersion(readJson(legacyManifestPath).version)) {
    const legacyManifest = readJson(legacyManifestPath);
    legacyManifest.version = nextVersion;
    writeJson(legacyManifestPath, legacyManifest);
  }

  console.log(`Updated Save Sora version: ${v2ManifestVersion} -> ${nextVersion}`);
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
