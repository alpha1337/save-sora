import type { ArchiveOrganizerRow, ArchiveSupplementalEntry, ArchiveWorkPlan, VideoRow } from "types/domain";
import { sanitizeFileNamePart, uniqueStrings } from "@lib/utils/string-utils";

/**
 * Creates the single-storage archive plan and the organizer manifest/scripts
 * that recreate the linked library layout after extraction.
 */
export function buildArchiveWorkPlan(rows: VideoRow[], archiveName: string): ArchiveWorkPlan {
  const downloadableRows = rows.filter((row) => row.video_id && row.is_downloadable);
  const organizerRows = downloadableRows.map(buildOrganizerRow);
  const supplementalEntries = buildArchiveSupplementalEntries(organizerRows);

  return {
    rows: downloadableRows,
    organizer_rows: organizerRows,
    supplemental_entries: supplementalEntries,
    archive_name: sanitizeFileNamePart(archiveName, "save-sora-library")
  };
}

function buildOrganizerRow(row: VideoRow): ArchiveOrganizerRow {
  const fileName = `${sanitizeFileNamePart(row.title || row.video_id, row.video_id)}-${row.video_id}.mp4`;
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
      archive_path: "organizer/create-links-windows.ps1",
      content: buildWindowsOrganizerScript()
    },
    {
      archive_path: "organizer/README.txt",
      content: buildOrganizerReadme()
    }
  ];
}

function buildMacOrganizerScript(): string {
  return String.raw`#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="\${1:-.}"
MANIFEST_PATH="\${ROOT_DIR}/organizer/link-manifest.json"

python3 - "$ROOT_DIR" "$MANIFEST_PATH" <<'PY'
import json
import os
import pathlib
import sys

root_dir = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
for item in manifest.get("items", []):
  source_path = root_dir / item["library_path"]
  if not source_path.exists():
    continue
  for rel_path in item.get("link_paths", []):
    target_path = root_dir / rel_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if target_path.exists() or target_path.is_symlink():
      continue
    relative_source = os.path.relpath(str(source_path), str(target_path.parent))
    target_path.symlink_to(relative_source)
PY
`;
}

function buildWindowsOrganizerScript(): string {
  return String.raw`param([string]$RootDir = ".")
$resolvedRoot = (Resolve-Path $RootDir).Path
$manifestPath = Join-Path $resolvedRoot "organizer\link-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$libraryPath = Join-Path $resolvedRoot "library"
$organizedLibraryAlias = Join-Path $resolvedRoot "organized\library"

if ((Test-Path -LiteralPath $libraryPath) -and !(Test-Path -LiteralPath $organizedLibraryAlias)) {
  $organizedAliasParent = Split-Path -Parent $organizedLibraryAlias
  New-Item -ItemType Directory -Path $organizedAliasParent -Force | Out-Null
  try {
    New-Item -ItemType Junction -Path $organizedLibraryAlias -Target $libraryPath -Force | Out-Null
  } catch {}
}

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
    } catch {
      try {
        New-Item -ItemType HardLink -Path $targetPath -Target $sourcePath -Force | Out-Null
      } catch {
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
      }
    }
  }
}
`;
}

function buildOrganizerReadme(): string {
  return [
    "Save Sora Organizer",
    "",
    "Videos are stored once under library/.",
    "Run the organizer script after extracting the ZIP to create the cross-linked views.",
    "",
    "macOS/Linux: ./organizer/create-links-macos.sh",
    "Windows PowerShell: .\\organizer\\create-links-windows.ps1"
  ].join("\n");
}
