import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/**
 * Produces a clean extension-only distribution folder and a versioned zip file
 * for Chrome Web Store uploads or manual release handoff.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(repoRoot, "dist");

/**
 * Reads the manifest up front so the package version and popup entry stay
 * aligned with the actual extension source of truth.
 */
const manifestPath = path.join(repoRoot, "manifest.json");
assertExists(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const packageSlug = "save-sora";
const packageDir = path.join(distRoot, packageSlug);
const zipPath = path.join(distRoot, `${packageSlug}-v${manifest.version}.zip`);
const updateManifestPath = path.join(distRoot, `${packageSlug}-update-manifest.json`);

const requiredRootEntries = [
  "manifest.json",
  "background.js",
  "offscreen.html",
  "offscreen.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "popup",
  "vendor",
];

main();

function main() {
  validateRequiredEntries();

  const assetPaths = collectAssetPaths();
  const packageEntries = [...requiredRootEntries, ...assetPaths].sort();

  recreateDirectory(distRoot);
  mkdirSync(packageDir, { recursive: true });

  for (const relativePath of packageEntries) {
    copyIntoPackage(relativePath);
  }

  writeBuildReport(packageEntries);
  createZipArchive();
  writeUpdateManifest(packageEntries);

  console.log(`Built unpacked extension: ${relativePathFromRepo(packageDir)}`);
  console.log(`Built zip archive: ${relativePathFromRepo(zipPath)}`);
  console.log(`Built update manifest: ${relativePathFromRepo(updateManifestPath)}`);
}

/**
 * Fails fast when a required runtime entry has been renamed or deleted so the
 * release artifact never silently ships an incomplete extension.
 */
function validateRequiredEntries() {
  for (const relativePath of requiredRootEntries) {
    assertExists(path.join(repoRoot, relativePath));
  }
}

/**
 * Collects asset references from extension-only source files so the dist bundle
 * stays lean and does not ship GitHub Pages screenshots or other non-runtime
 * media.
 */
function collectAssetPaths() {
  const assetPaths = new Set();

  for (const iconPath of Object.values(manifest.icons || {})) {
    assetPaths.add(iconPath);
  }

  for (const iconPath of Object.values(manifest.action?.default_icon || {})) {
    assetPaths.add(iconPath);
  }

  const scanTargets = [
    "popup.html",
    "popup.css",
    "popup.js",
    ...listFilesRecursively(path.join(repoRoot, "popup")).map((absolutePath) =>
      path.relative(repoRoot, absolutePath)
    )
  ];

  const assetPattern = /assets\/[A-Za-z0-9._/-]+/g;

  for (const relativePath of scanTargets) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = readFileSync(absolutePath, "utf8");
    const matches = content.match(assetPattern) || [];

    for (const match of matches) {
      assetPaths.add(match);
    }
  }

  for (const assetPath of assetPaths) {
    assertExists(path.join(repoRoot, assetPath));
  }

  return [...assetPaths];
}

/**
 * Copies a file or directory while preserving the source tree shape inside the
 * unpacked extension folder.
 */
function copyIntoPackage(relativePath) {
  const sourcePath = path.join(repoRoot, relativePath);
  const destinationPath = path.join(packageDir, relativePath);
  const sourceStats = statSync(sourcePath);

  mkdirSync(path.dirname(destinationPath), { recursive: true });

  if (sourceStats.isDirectory()) {
    cpSync(sourcePath, destinationPath, { recursive: true });
    return;
  }

  cpSync(sourcePath, destinationPath);
}

/**
 * Writes a small manifest of packaged files so contributors can quickly audit
 * what the release pipeline includes without opening the zip archive itself.
 */
function writeBuildReport(packageEntries) {
  const reportLines = [
    `Package: ${packageSlug}`,
    `Version: ${manifest.version}`,
    "",
    "Included files:",
    ...packageEntries.map((entry) => `- ${entry}`)
  ];

  writeFileSync(path.join(distRoot, "build-report.txt"), `${reportLines.join("\n")}\n`, "utf8");
}

/**
 * Creates the release zip after the unpacked folder is prepared. The script
 * uses platform-native archivers so the repo stays dependency-free.
 */
function createZipArchive() {
  rmSync(zipPath, { force: true });

  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path "${packageDir}\\*" -DestinationPath "${zipPath}" -Force`
      ],
      { stdio: "inherit" }
    );
    return;
  }

  execFileSync("zip", ["-qr", zipPath, packageSlug], {
    cwd: distRoot,
    stdio: "inherit"
  });
}

function writeUpdateManifest(packageEntries) {
  const zipBuffer = readFileSync(zipPath);
  const zipSha256 = createHash("sha256").update(zipBuffer).digest("hex");
  const updateManifest = {
    name: manifest.name,
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    packageSlug,
    zipFileName: path.basename(zipPath),
    zipSha256,
    managedFiles: packageEntries,
  };

  writeFileSync(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");
}

function recreateDirectory(targetPath) {
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(targetPath, { recursive: true });
}

function listFilesRecursively(startPath) {
  const entries = readdirSync(startPath, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const entryPath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...listFilesRecursively(entryPath));
      continue;
    }

    filePaths.push(entryPath);
  }

  return filePaths;
}

function assertExists(targetPath) {
  if (!existsSync(targetPath)) {
    throw new Error(`Expected build input is missing: ${relativePathFromRepo(targetPath)}`);
  }
}

function relativePathFromRepo(targetPath) {
  return path.relative(repoRoot, targetPath) || ".";
}
