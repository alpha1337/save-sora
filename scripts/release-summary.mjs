import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PUBLIC_RELEASE_NOTES = "This build includes fixes and improvements for Save Sora.";
const MAX_PUBLIC_SUMMARY_LENGTH = 120;

export function normalizePublicReleaseSummary(value) {
  return String(value || "")
    .trim()
    .replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, "")
    .replace(/^(?:ship|release)\s+v?\d+\.\d+\.\d+\s*[:\-]?\s*/i, "")
    .replace(/^v?\d+\.\d+\.\d+\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function requirePublicReleaseSummary(value) {
  const summary = normalizePublicReleaseSummary(value);

  if (!summary) {
    throw new Error(
      'Ship requires a short public summary, for example: npm run ship -- "improves fetch recovery and update prompts"',
    );
  }

  if (summary.length > MAX_PUBLIC_SUMMARY_LENGTH) {
    throw new Error(
      `Ship summary must stay concise for public release notes (${summary.length}/${MAX_PUBLIC_SUMMARY_LENGTH} characters).`,
    );
  }

  return summary;
}

export function buildShipCommitSubject(version, summary) {
  const normalizedVersion = String(version || "").trim();
  const normalizedSummary = requirePublicReleaseSummary(summary);

  if (!normalizedVersion) {
    throw new Error("Ship commit subject requires a valid release version.");
  }

  return `Ship ${normalizedVersion} ${normalizedSummary}`;
}

export function buildPublicReleaseNotes(value) {
  const summary = normalizePublicReleaseSummary(value);
  if (!summary) {
    return DEFAULT_PUBLIC_RELEASE_NOTES;
  }
  return `${capitalizeFirstCharacter(summary)}.`;
}

function capitalizeFirstCharacter(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isCliEntryPoint() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

function printUsageAndExit() {
  console.error("Usage: node scripts/release-summary.mjs <notes|normalize> <text>");
  process.exit(1);
}

if (isCliEntryPoint()) {
  const command = process.argv[2];
  const text = process.argv.slice(3).join(" ");

  if (!command) {
    printUsageAndExit();
  }

  if (command === "notes") {
    process.stdout.write(buildPublicReleaseNotes(text));
    process.exit(0);
  }

  if (command === "normalize") {
    process.stdout.write(normalizePublicReleaseSummary(text));
    process.exit(0);
  }

  printUsageAndExit();
}
