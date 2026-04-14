import type { ArchiveOrganizerRow, ArchiveSupplementalEntry, ArchiveWorkPlan, VideoRow } from "types/domain";
import { compactWhitespace, sanitizeFileNamePart, uniqueStrings } from "@lib/utils/string-utils";

const MAX_LIBRARY_FILE_STEM_LENGTH = 48;

/**
 * Creates the single-storage archive plan and the organizer manifest/scripts
 * that recreate the linked library layout after extraction.
 */
export function buildArchiveWorkPlan(rows: VideoRow[], archiveName: string): ArchiveWorkPlan {
  const downloadableRows = dedupeRowsByVideoId(rows.filter((row) => row.video_id && row.is_downloadable));
  const organizerRows = downloadableRows.map(buildOrganizerRow);
  const supplementalEntries = buildArchiveSupplementalEntries(organizerRows);

  return {
    rows: downloadableRows,
    organizer_rows: organizerRows,
    supplemental_entries: supplementalEntries,
    archive_name: sanitizeFileNamePart(archiveName, "save-sora-library")
  };
}

function dedupeRowsByVideoId(rows: VideoRow[]): VideoRow[] {
  const rowByVideoId = new Map<string, VideoRow>();
  for (const row of rows) {
    if (!rowByVideoId.has(row.video_id)) {
      rowByVideoId.set(row.video_id, row);
    }
  }
  return [...rowByVideoId.values()];
}

function buildOrganizerRow(row: VideoRow): ArchiveOrganizerRow {
  const fileName = buildLibraryFileName(row);
  const linkPaths = new Set<string>([
    `organized/by-source/${sanitizeFileNamePart(row.source_type, "source")}/${fileName}`,
    `organized/by-category/${sanitizeFileNamePart(row.source_bucket, "category")}/${fileName}`
  ]);

  for (const categoryTag of row.category_tags) {
    linkPaths.add(`organized/by-category/${sanitizeFileNamePart(categoryTag, "category")}/${fileName}`);
  }
  for (const characterName of row.character_names) {
    linkPaths.add(`organized/by-character/${sanitizeFileNamePart(characterName, "character")}/${fileName}`);
  }
  if (row.creator_name) {
    linkPaths.add(`organized/by-creator/${sanitizeFileNamePart(row.creator_name, "creator")}/${fileName}`);
  }

  return {
    video_id: row.video_id,
    file_name: fileName,
    library_path: `library/${fileName}`,
    link_paths: [...linkPaths].sort(),
    source_bucket: row.source_bucket,
    creator_name: row.creator_name,
    character_names: uniqueStrings(row.character_names),
    category_tags: uniqueStrings(row.category_tags)
  };
}

function buildLibraryFileName(row: VideoRow): string {
  const stem = resolveLibraryFileStem(row);
  return `${stem}-${row.video_id}.mp4`;
}

function resolveLibraryFileStem(row: VideoRow): string {
  const discoveryPhrase = compactWhitespace(row.discovery_phrase);
  if (discoveryPhrase) {
    return sanitizeFileNamePart(truncateFileStem(discoveryPhrase), "video");
  }

  const fallbackId = buildCharacterCreatorId(row);
  if (fallbackId) {
    return sanitizeFileNamePart(truncateFileStem(fallbackId), "video");
  }

  return sanitizeFileNamePart(row.video_id, "video");
}

function buildCharacterCreatorId(row: VideoRow): string {
  const parts = [
    normalizeIdPart(row.character_username || row.character_name),
    normalizeIdPart(row.creator_username || row.creator_name)
  ].filter(Boolean);
  return parts.join(".");
}

function normalizeIdPart(value: string): string {
  return sanitizeFileNamePart(value, "")
    .replace(/\s+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/-+/g, "-");
}

function truncateFileStem(value: string): string {
  if (value.length <= MAX_LIBRARY_FILE_STEM_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_LIBRARY_FILE_STEM_LENGTH).trim();
}

function buildArchiveSupplementalEntries(organizerRows: ArchiveOrganizerRow[]): ArchiveSupplementalEntry[] {
  return [
    {
      archive_path: "organizer/link-manifest.json",
      content: JSON.stringify({ version: 1, libraryRoot: "library", items: organizerRows }, null, 2)
    },
    {
      archive_path: "organizer/create-links-macos.sh",
      content: buildMacOrganizerScript()
    },
    {
      archive_path: "organizer/Install Organizer.command",
      content: buildMacOrganizerCommandInstaller()
    },
    {
      archive_path: "organizer/create-links-windows.ps1",
      content: buildWindowsOrganizerScript()
    },
    {
      archive_path: "organizer/Run Organizer.bat",
      content: buildWindowsOrganizerBatchScript()
    },
    {
      archive_path: "organizer/README.txt",
      content: buildOrganizerReadme()
    }
  ];
}

function buildMacOrganizerScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "ROOT_DIR=\"${1:-$(cd \"$SCRIPT_DIR/..\" && pwd)}\"",
    "MANIFEST_PATH=\"$ROOT_DIR/organizer/link-manifest.json\"",
    "",
    "if [[ ! -f \"$MANIFEST_PATH\" ]]; then",
    "  echo \"Missing organizer manifest: $MANIFEST_PATH\" >&2",
    "  exit 1",
    "fi",
    "",
    "link_count=0",
    "while IFS=$'\\t' read -r source_path target_path; do",
    "  [[ -z \"$source_path\" || -z \"$target_path\" ]] && continue",
    "  [[ -e \"$source_path\" ]] || continue",
    "  mkdir -p \"$(dirname \"$target_path\")\"",
    "  if [[ -e \"$target_path\" || -L \"$target_path\" ]]; then",
    "    continue",
    "  fi",
    "  ln -s \"$source_path\" \"$target_path\"",
    "  link_count=$((link_count + 1))",
    "done < <(/usr/bin/osascript -l JavaScript \"$ROOT_DIR\" \"$MANIFEST_PATH\" <<'JXA'",
    "ObjC.import('Foundation');",
    "",
    "function readManifest(path) {",
    "  const text = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);",
    "  return JSON.parse(ObjC.unwrap(text));",
    "}",
    "",
    "function joinPath(root, rel) {",
    "  if (!rel) return root;",
    "  return root.replace(/\\/$/, '') + '/' + rel.replace(/^\\//, '');",
    "}",
    "",
    "function run(argv) {",
    "  const rootDir = String(argv[0] || '');",
    "  const manifestPath = String(argv[1] || '');",
    "  const manifest = readManifest(manifestPath);",
    "  const items = Array.isArray(manifest.items) ? manifest.items : [];",
    "  for (const item of items) {",
    "    const source = joinPath(rootDir, item.library_path || '');",
    "    const links = Array.isArray(item.link_paths) ? item.link_paths : [];",
    "    for (const relLink of links) {",
    "      const target = joinPath(rootDir, relLink);",
    "      console.log(source + '\\t' + target);",
    "    }",
    "  }",
    "}",
    "JXA",
    ")",
    "",
    "echo \"Created $link_count organizer links.\"",
    ""
  ].join("\n");
}

function buildMacOrganizerCommandInstaller(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
    "ROOT_DIR=\"$(cd \"$SCRIPT_DIR/..\" && pwd)\"",
    "bash \"$SCRIPT_DIR/create-links-macos.sh\" \"$ROOT_DIR\"",
    "open \"$ROOT_DIR/organized\" 2>/dev/null || true",
    "echo \"Organizer complete.\"",
    "read -r -p \"Press Enter to close...\" _",
    ""
  ].join("\n");
}

function buildWindowsOrganizerScript(): string {
  return String.raw`param(
  [string]$RootDir = "."
)

$resolvedRoot = (Resolve-Path $RootDir).Path
$manifestPath = Join-Path $resolvedRoot "organizer\link-manifest.json"

if (!(Test-Path -LiteralPath $manifestPath)) {
  Write-Error "Missing organizer manifest: $manifestPath"
  exit 1
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$createdCount = 0

foreach ($item in $manifest.items) {
  $sourcePath = Join-Path $resolvedRoot $item.library_path
  if (!(Test-Path -LiteralPath $sourcePath)) {
    continue
  }

  foreach ($relPath in $item.link_paths) {
    $targetPath = Join-Path $resolvedRoot $relPath
    $targetDir = Split-Path -Parent $targetPath
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

    if (Test-Path -LiteralPath $targetPath) {
      continue
    }

    try {
      New-Item -ItemType SymbolicLink -Path $targetPath -Target $sourcePath -Force | Out-Null
      $createdCount++
    } catch {
      try {
        New-Item -ItemType HardLink -Path $targetPath -Target $sourcePath -Force | Out-Null
        $createdCount++
      } catch {
        # No fallback copy: keep single-storage invariant.
      }
    }
  }
}

Write-Host "Created $createdCount organizer links."
`;
}

function buildWindowsOrganizerBatchScript(): string {
  return [
    "@echo off",
    "setlocal",
    "set SCRIPT_DIR=%~dp0",
    "set ROOT_DIR=%SCRIPT_DIR%..",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%SCRIPT_DIR%create-links-windows.ps1\" \"%ROOT_DIR%\"",
    "if exist \"%ROOT_DIR%\\organized\" start \"\" \"%ROOT_DIR%\\organized\"",
    "echo Organizer complete.",
    "pause",
    ""
  ].join("\r\n");
}

function buildOrganizerReadme(): string {
  return [
    "Save Sora Organizer",
    "",
    "Run one post-extract organizer step to create linked views in organized/.",
    "",
    "macOS: double-click organizer/Install Organizer.command",
    "Windows: double-click organizer/Run Organizer.bat",
    "",
    "No duplicate media files are created. Links point back to library/."
  ].join("\n");
}
