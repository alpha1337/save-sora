import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(v2Root, "..");
const outDir = path.join(v2Root, ".build");
const nodeExec = process.execPath;
const esbuildCli = path.join(repoRoot, "node_modules", "esbuild", "bin", "esbuild");
const viteCli = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

main();

function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  runNode([viteCli, "build", "--config", path.join(v2Root, "vite.config.ts")]);

  mkdirSync(path.join(outDir, "background"), { recursive: true });
  mkdirSync(path.join(outDir, "injected"), { recursive: true });

  runExecutable(esbuildCli, [
    path.join(v2Root, "background", "service-worker.ts"),
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=chrome114",
    `--outfile=${path.join(outDir, "background", "service-worker.js")}`
  ]);

  runExecutable(esbuildCli, [
    path.join(v2Root, "injected", "content-script.ts"),
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=chrome114",
    `--outfile=${path.join(outDir, "injected", "content-script.js")}`
  ]);

  cpSync(path.join(v2Root, "manifest.json"), path.join(outDir, "manifest.json"));
}

function runNode(args) {
  execFileSync(nodeExec, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

function runExecutable(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}
