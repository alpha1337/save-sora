import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const installerSourceDir = join(repoRoot, "organizer", "windows-installer");
const stageDir = join(repoRoot, ".build", "windows-organizer-installer");
const outDir = join(repoRoot, "dist");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

for (const fileName of ["OrganizerLauncher.cmd", "OrganizerLauncher.ps1", "SaveSoraOrganizer.nsi"]) {
  cpSync(join(installerSourceDir, fileName), join(stageDir, fileName));
}

const makensis = process.platform === "win32" ? "makensis.exe" : "makensis";
const nsiPath = join(stageDir, "SaveSoraOrganizer.nsi");
const result = spawnSync(
  makensis,
  [`/XOutFile "${join(outDir, "SaveSoraOrganizerSetup.exe")}"`, nsiPath],
  {
    shell: true,
    stdio: "inherit"
  }
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`makensis failed with exit code ${result.status}. Install NSIS and retry.`);
}

if (!existsSync(join(outDir, "SaveSoraOrganizerSetup.exe"))) {
  throw new Error("Installer output not found: dist/SaveSoraOrganizerSetup.exe");
}

console.log("Built Windows organizer installer: dist/SaveSoraOrganizerSetup.exe");
