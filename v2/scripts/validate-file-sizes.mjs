import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const maxLines = 1000;
const allowedExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".build", "public"]);

const violations = [];
scanDirectory(v2Root);

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.relativePath}: ${violation.lineCount} lines exceeds ${maxLines}`);
  }
  process.exit(1);
}

console.log("All v2 files are within the 1000 line limit.");

function scanDirectory(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(absolutePath);
      continue;
    }

    const extension = path.extname(entry.name);
    if (!allowedExtensions.has(extension)) {
      continue;
    }

    const lineCount = readFileSync(absolutePath, "utf8").split(/\r?\n/).length;
    if (lineCount > maxLines) {
      violations.push({
        relativePath: path.relative(v2Root, absolutePath),
        lineCount
      });
    }
  }
}
