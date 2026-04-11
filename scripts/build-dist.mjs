import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const buildRoot = path.join(repoRoot, "v2", ".build");
const distRoot = path.join(repoRoot, "dist");
const manifestPath = path.join(buildRoot, "manifest.json");

assertExists(buildRoot);
assertExists(manifestPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageSlug = "save-sora";
const packageDir = path.join(distRoot, packageSlug);
const zipPath = path.join(distRoot, `${packageSlug}-v${manifest.version}.zip`);
const updateManifestPath = path.join(distRoot, `${packageSlug}-update-manifest.json`);
const requiredBuildEntries = [
  "manifest.json",
  "app.html",
  "background/service-worker.js",
  "injected/content-script.js"
];

main();

function main() {
  validateRequiredEntries();
  const packageEntries = collectManagedRuntimeEntries(buildRoot);

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

function validateRequiredEntries() {
  for (const relativePath of requiredBuildEntries) {
    assertExists(path.join(buildRoot, relativePath));
  }
}

function collectManagedRuntimeEntries(rootPath) {
  return listFilesRecursively(rootPath)
    .map((absolutePath) => path.relative(rootPath, absolutePath))
    .sort();
}

function copyIntoPackage(relativePath) {
  const sourcePath = path.join(buildRoot, relativePath);
  const destinationPath = path.join(packageDir, relativePath);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath);
}

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
    managedFiles: packageEntries
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

    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
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
