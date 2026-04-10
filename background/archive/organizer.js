/*
 * Save Sora archive organizer helpers.
 * Owns archive path planning, organizer manifest/script generation, folder-image
 * discovery, and metadata text extraction for ZIP supplemental entries.
 *
 * Does not own runtime state, network requests, download orchestration, or
 * offscreen archive worker messaging. The background orchestrator injects core
 * item utilities through `createArchiveOrganizerHelpers`.
 */
(function initSaveSoraArchiveOrganizer(globalScope) {
  /**
   * Creates archive organizer helpers using background-owned dependencies.
   *
   * @param {object} deps
   * @returns {object}
   */
  function createArchiveOrganizerHelpers(deps = {}) {
    const getDownloadedVideoIdentitiesForItem =
      typeof deps.getDownloadedVideoIdentitiesForItem === "function"
        ? deps.getDownloadedVideoIdentitiesForItem
        : () => [];
    const getCanonicalItemKey =
      typeof deps.getCanonicalItemKey === "function"
        ? deps.getCanonicalItemKey
        : () => "";
    const getItemKey =
      typeof deps.getItemKey === "function"
        ? deps.getItemKey
        : () => "";
    const sanitizeFilenamePart =
      typeof deps.sanitizeFilenamePart === "function"
        ? deps.sanitizeFilenamePart
        : (value) => String(value || "").trim();

    function getArchiveMediaIdentity(item) {
      const identities = getDownloadedVideoIdentitiesForItem(item);
      const preferredPrefixes = ["post:", "generation:", "attachment:", "file:", "drive:", "path:"];

      for (const prefix of preferredPrefixes) {
        const match = identities.find(
          (identity) => typeof identity === "string" && identity.startsWith(prefix),
        );
        if (match) {
          return match;
        }
      }

      const canonicalKey = getCanonicalItemKey(item);
      return canonicalKey || getItemKey(item || {});
    }

    function buildArchiveLibraryEntryPath(item) {
      return `library/${getArchiveFilename(item)}`;
    }

    function getArchiveOrganizerLinkPathCandidates(item) {
      const filename = getArchiveFilename(item);
      const sourceLabel =
        sanitizeFilenamePart(
          (item && typeof item.sourceLabel === "string" && item.sourceLabel) ||
          (item && typeof item.sourcePage === "string" && item.sourcePage) ||
          "source",
        ) || "source";
      const categoryFolder = getArchiveMediaFolderPath(item);
      const candidates = [
        `organized/by-source/${sourceLabel}/${filename}`,
        `organized/by-category/${categoryFolder}/${filename}`,
      ];

      if (
        item &&
        typeof item.characterAccountDisplayName === "string" &&
        item.characterAccountDisplayName
      ) {
        candidates.push(
          `organized/by-character/${sanitizeFilenamePart(item.characterAccountDisplayName) || "character"}/${filename}`,
        );
      }

      if (
        item &&
        typeof item.creatorProfileDisplayName === "string" &&
        item.creatorProfileDisplayName
      ) {
        candidates.push(
          `organized/by-creator/${sanitizeFilenamePart(item.creatorProfileDisplayName) || "creator"}/${filename}`,
        );
      }

      return [...new Set(candidates)];
    }

    function buildArchiveWorkItems(items) {
      const libraryUsedPaths = new Set();
      const organizerUsedPaths = new Set();
      const archivePathByIdentity = new Map();
      const archiveItems = [];
      const organizerRows = [];

      for (const item of Array.isArray(items) ? items : []) {
        const mediaIdentity = getArchiveMediaIdentity(item);
        const existingArchivePath = archivePathByIdentity.get(mediaIdentity);
        const archivePath =
          existingArchivePath || uniquifyArchivePath(buildArchiveLibraryEntryPath(item), libraryUsedPaths);

        if (!existingArchivePath) {
          archivePathByIdentity.set(mediaIdentity, archivePath);
          archiveItems.push({
            ...item,
            archivePath,
          });
        }

        const linkPaths = getArchiveOrganizerLinkPathCandidates(item).map((candidatePath) =>
          uniquifyArchivePath(candidatePath, organizerUsedPaths),
        );
        organizerRows.push({
          key: getCanonicalItemKey(item),
          id: item && typeof item.id === "string" ? item.id : "",
          filename: getArchiveFilename(item),
          sourcePage: item && typeof item.sourcePage === "string" ? item.sourcePage : "",
          sourceLabel: item && typeof item.sourceLabel === "string" ? item.sourceLabel : "",
          creator:
            item && typeof item.creatorProfileDisplayName === "string"
              ? item.creatorProfileDisplayName
              : "",
          character:
            item && typeof item.characterAccountDisplayName === "string"
              ? item.characterAccountDisplayName
              : "",
          libraryPath: archivePath,
          linkPaths,
        });
      }

      return {
        archiveItems,
        organizerRows,
      };
    }

    function getArchiveMediaFolderPath(item) {
      switch (item && item.sourcePage) {
        case "profile":
          return "published";
        case "drafts":
          return "drafts";
        case "likes":
          return "liked";
        case "cameos":
          return "cameos";
        case "characters":
          return `characters/${getArchiveCharacterFolderName(item)}/${item && item.sourceType === "draft" ? "drafts" : "published"}`;
        case "creatorPublished":
          return `creators/${getArchiveCreatorFolderName(item)}/published`;
        case "creatorCameos":
          return `creators/${getArchiveCreatorFolderName(item)}/cameos`;
        case "creatorCharacters":
          return `creators/${getArchiveCreatorFolderName(item)}/characters`;
        case "creatorCharacterCameos":
          return `creators/${getArchiveCreatorFolderName(item)}/character-cameos`;
        default:
          return "videos";
      }
    }

    function getArchiveFolderImagePath(item) {
      if (!item || item.sourcePage !== "characters") {
        if (
          item &&
          (item.sourcePage === "creatorPublished" ||
            item.sourcePage === "creatorCameos" ||
            item.sourcePage === "creatorCharacters" ||
            item.sourcePage === "creatorCharacterCameos")
        ) {
          return getArchiveMediaFolderPath(item);
        }
        return getArchiveMediaFolderPath(item);
      }

      return `characters/${getArchiveCharacterFolderName(item)}`;
    }

    function getArchiveCharacterFolderName(item) {
      const preferredName =
        (item && item.characterAccountDisplayName) ||
        (item && item.characterAccountUsername) ||
        (item && item.characterAccountId) ||
        "character";
      return sanitizeFilenamePart(preferredName) || "character";
    }

    function getArchiveCreatorFolderName(item) {
      const preferredName =
        (item && item.creatorProfileDisplayName) ||
        (item && item.creatorProfileUsername) ||
        (item && item.creatorProfileId) ||
        "creator";
      return sanitizeFilenamePart(preferredName) || "creator";
    }

    function getArchiveFilename(item) {
      const rawFilename =
        item && typeof item.filename === "string" && item.filename
          ? item.filename
          : `${(item && item.id) || "video"}.mp4`;
      const lastSegment = rawFilename.split("/").pop() || rawFilename;
      const extensionMatch = lastSegment.match(/(\.[A-Za-z0-9]{1,10})$/);
      const extension = extensionMatch ? extensionMatch[1].toLowerCase() : ".bin";
      const basename = extensionMatch ? lastSegment.slice(0, -extension.length) : lastSegment;
      const safeBasename = sanitizeFilenamePart(basename) || "video";
      return `${safeBasename}${extension}`;
    }

    function uniquifyArchivePath(desiredPath, usedPaths) {
      const normalizedPath = String(desiredPath || "").replace(/^\/+|\/+$/g, "");
      if (!usedPaths.has(normalizedPath)) {
        usedPaths.add(normalizedPath);
        return normalizedPath;
      }

      const lastSlashIndex = normalizedPath.lastIndexOf("/");
      const folderPath = lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
      const filename = lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
      const extensionMatch = filename.match(/(\.[A-Za-z0-9]{1,10})$/);
      const extension = extensionMatch ? extensionMatch[1] : "";
      const basename = extensionMatch ? filename.slice(0, -extension.length) : filename;

      for (let suffix = 2; suffix < 10000; suffix += 1) {
        const candidateFilename = `${basename}-${suffix}${extension}`;
        const candidatePath = folderPath ? `${folderPath}/${candidateFilename}` : candidateFilename;
        if (!usedPaths.has(candidatePath)) {
          usedPaths.add(candidatePath);
          return candidatePath;
        }
      }

      usedPaths.add(normalizedPath);
      return normalizedPath;
    }

    function buildArchiveFolderImages(items) {
      const folderImages = new Map();

      for (const item of Array.isArray(items) ? items : []) {
        const candidate = getArchiveFolderImageCandidate(item);
        if (!candidate || folderImages.has(candidate.folderPath)) {
          continue;
        }

        folderImages.set(candidate.folderPath, candidate);
      }

      return [...folderImages.values()].sort((left, right) => left.folderPath.localeCompare(right.folderPath));
    }

    function buildArchiveSupplementalEntries(items, organizerRows = [], now = new Date()) {
      const createdAt = now.toISOString();
      const metadataText = buildArchiveMetadataText(items);
      const entries = [];

      if (metadataText) {
        entries.push(
          createArchiveTextSupplementalEntry(
            `metadata/${buildArchiveSelectedMetadataFilename(now)}`,
            metadataText,
            createdAt,
          ),
        );
      }

      const organizerManifestText = buildArchiveOrganizerManifestText(organizerRows, now);
      if (organizerManifestText) {
        entries.push(
          createArchiveTextSupplementalEntry(
            "organizer/link-manifest.json",
            organizerManifestText,
            createdAt,
          ),
        );
        entries.push(
          createArchiveTextSupplementalEntry(
            "organizer/create-links-macos.sh",
            buildArchiveOrganizerMacScript(),
            createdAt,
          ),
        );
        entries.push(
          createArchiveTextSupplementalEntry(
            "organizer/create-links-windows.ps1",
            buildArchiveOrganizerWindowsScript(),
            createdAt,
          ),
        );
        entries.push(
          createArchiveTextSupplementalEntry(
            "organizer/README.txt",
            buildArchiveOrganizerReadme(),
            createdAt,
          ),
        );
      }

      return entries;
    }

    function createArchiveTextSupplementalEntry(archivePath, textContent, createdAt) {
      return {
        archivePath,
        createdAt,
        blobContent: new Blob([textContent], {
          type: "text/plain;charset=utf-8",
        }),
      };
    }

    function buildArchiveOrganizerManifestText(rows, now = new Date()) {
      const organizerRows = Array.isArray(rows) ? rows : [];
      if (organizerRows.length === 0) {
        return "";
      }

      return JSON.stringify(
        {
          version: 1,
          generatedAt: now.toISOString(),
          libraryRoot: "library",
          items: organizerRows.map((entry) => ({
            key: entry && typeof entry.key === "string" ? entry.key : "",
            id: entry && typeof entry.id === "string" ? entry.id : "",
            filename: entry && typeof entry.filename === "string" ? entry.filename : "",
            sourcePage: entry && typeof entry.sourcePage === "string" ? entry.sourcePage : "",
            sourceLabel: entry && typeof entry.sourceLabel === "string" ? entry.sourceLabel : "",
            creator: entry && typeof entry.creator === "string" ? entry.creator : "",
            character: entry && typeof entry.character === "string" ? entry.character : "",
            libraryPath: entry && typeof entry.libraryPath === "string" ? entry.libraryPath : "",
            linkPaths: Array.isArray(entry && entry.linkPaths)
              ? entry.linkPaths.filter((linkPath) => typeof linkPath === "string" && linkPath)
              : [],
          })),
        },
        null,
        2,
      );
    }

    function buildArchiveOrganizerMacScript() {
      return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="\${1:-.}"
MANIFEST_PATH="\${ROOT_DIR}/organizer/link-manifest.json"

if [[ ! -f "\${MANIFEST_PATH}" ]]; then
  echo "Missing organizer manifest: \${MANIFEST_PATH}" >&2
  exit 1
fi

python3 - "\${ROOT_DIR}" "\${MANIFEST_PATH}" <<'PY'
import json
import os
import pathlib
import sys

root_dir = pathlib.Path(sys.argv[1]).resolve()
manifest_path = pathlib.Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

for item in manifest.get("items", []):
  source_path = root_dir / item.get("libraryPath", "")
  if not source_path.exists():
    continue

  for rel_path in item.get("linkPaths", []):
    target_path = root_dir / rel_path
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if target_path.exists() or target_path.is_symlink():
      continue

    relative_source = os.path.relpath(str(source_path), str(target_path.parent))
    target_path.symlink_to(relative_source)
PY

echo "Organizer links created."
`;
    }

    function buildArchiveOrganizerWindowsScript() {
      return `param(
  [string]$RootDir = "."
)

$resolvedRoot = (Resolve-Path $RootDir).Path
$manifestPath = Join-Path $resolvedRoot "organizer\\link-manifest.json"

if (!(Test-Path $manifestPath)) {
  Write-Error "Missing organizer manifest: $manifestPath"
  exit 1
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$libraryPath = Join-Path $resolvedRoot "library"
$organizedLibraryAlias = Join-Path $resolvedRoot "organized\\library"

if ((Test-Path -LiteralPath $libraryPath) -and !(Test-Path -LiteralPath $organizedLibraryAlias)) {
  $organizedAliasParent = Split-Path -Parent $organizedLibraryAlias
  New-Item -ItemType Directory -Path $organizedAliasParent -Force | Out-Null
  try {
    New-Item -ItemType Junction -Path $organizedLibraryAlias -Target $libraryPath -Force | Out-Null
  } catch {
    # Junction creation is best-effort only.
  }
}

foreach ($item in $manifest.items) {
  $sourcePath = Join-Path $resolvedRoot $item.libraryPath
  if (!(Test-Path -LiteralPath $sourcePath)) {
    continue
  }

  foreach ($relPath in $item.linkPaths) {
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

Write-Host "Organizer links created."
`;
    }

    function buildArchiveOrganizerReadme() {
      return [
        "Save Sora Organizer",
        "",
        "Videos are stored once under the `library/` folder.",
        "Run the platform script from the extracted archive root to create organized links:",
        "",
        "macOS/Linux: ./organizer/create-links-macos.sh",
        "Windows PowerShell: .\\organizer\\create-links-windows.ps1",
        "",
        "The scripts create symbolic links when possible.",
        "On Windows, the script also creates an `organized\\\\library` junction and falls back to hard links when file symlinks are unavailable.",
      ].join("\\n");
    }

    function buildArchiveMetadataText(items) {
      const rows = [];

      for (const item of Array.isArray(items) ? items : []) {
        const exportText = getArchiveMetadataText(item);

        if (exportText) {
          const title = getArchiveMetadataTitle(item);
          rows.push(title && title !== exportText ? `${title}\r\n${exportText}` : exportText);
        }
      }

      return rows.join("\r\n\r\n");
    }

    function getArchiveMetadataText(item) {
      const candidates = [
        item && typeof item.prompt === "string" ? item.prompt.trim() : "",
        item && typeof item.description === "string" ? item.description.trim() : "",
        item && typeof item.discoveryPhrase === "string" ? item.discoveryPhrase.trim() : "",
        item && typeof item.discovery_phrase === "string" ? item.discovery_phrase.trim() : "",
        item && typeof item.caption === "string" ? item.caption.trim() : "",
      ];
      const nestedCandidates = [
        getArchiveNestedMetadataText(item, ["prompt"]),
        getArchiveNestedMetadataText(item, ["description"]),
        getArchiveNestedMetadataText(item, ["discoveryPhrase", "discovery_phrase"]),
        getArchiveNestedMetadataText(item, ["caption"]),
      ];
      return [...candidates, ...nestedCandidates].find(Boolean) || "";
    }

    function getArchiveMetadataTitle(item) {
      const candidates = [
        item && typeof item.filename === "string" ? item.filename.replace(/\.mp4$/i, "").trim() : "",
        item && typeof item.discoveryPhrase === "string" ? item.discoveryPhrase.trim() : "",
        item && typeof item.discovery_phrase === "string" ? item.discovery_phrase.trim() : "",
        item && typeof item.prompt === "string" ? item.prompt.trim() : "",
        item && typeof item.description === "string" ? item.description.trim() : "",
        item && typeof item.caption === "string" ? item.caption.trim() : "",
        item && typeof item.id === "string" ? item.id.trim() : "video",
      ];
      const nestedCandidates = [
        getArchiveNestedMetadataText(item, ["discoveryPhrase", "discovery_phrase"]),
        getArchiveNestedMetadataText(item, ["prompt"]),
        getArchiveNestedMetadataText(item, ["description"]),
        getArchiveNestedMetadataText(item, ["caption"]),
      ];
      return [...candidates, ...nestedCandidates].find(Boolean) || "video";
    }

    function getArchiveNestedMetadataText(item, fieldNames) {
      const normalizedFieldNames = [...new Set(
        (Array.isArray(fieldNames) ? fieldNames : [fieldNames])
          .filter((fieldName) => typeof fieldName === "string" && fieldName)
          .map((fieldName) => fieldName.trim())
          .filter(Boolean),
      )];

      const matchesFieldName = (candidateKey) =>
        normalizedFieldNames.some((fieldName) => candidateKey === fieldName);

      function findNestedMetadataText(value, depth = 0, seen = new Set()) {
        if (depth > 6 || value == null) {
          return "";
        }

        if (typeof value === "string") {
          return "";
        }

        if (Array.isArray(value)) {
          for (const entry of value) {
            const nestedMatch = findNestedMetadataText(entry, depth + 1, seen);
            if (nestedMatch) {
              return nestedMatch;
            }
          }
          return "";
        }

        if (typeof value !== "object") {
          return "";
        }

        if (seen.has(value)) {
          return "";
        }
        seen.add(value);

        for (const [entryKey, entryValue] of Object.entries(value)) {
          if (!matchesFieldName(entryKey)) {
            continue;
          }

          if (typeof entryValue === "string") {
            const trimmed = entryValue.trim();
            if (trimmed) {
              return trimmed;
            }
          }
        }

        const priorityKeys = [
          "post",
          "draft",
          "item",
          "data",
          "output",
          "result",
          "generation",
          "creation_config",
          "creationConfig",
          "payload",
          "content",
          "metadata",
          "attributes",
          "details",
          "context",
        ];

        for (const priorityKey of priorityKeys) {
          if (!(priorityKey in value)) {
            continue;
          }

          const nestedMatch = findNestedMetadataText(value[priorityKey], depth + 1, seen);
          if (nestedMatch) {
            return nestedMatch;
          }
        }

        for (const [entryKey, entryValue] of Object.entries(value)) {
          if (/prompt|description|caption|discovery|content|metadata|text/i.test(entryKey) === false) {
            continue;
          }

          const nestedMatch = findNestedMetadataText(entryValue, depth + 1, seen);
          if (nestedMatch) {
            return nestedMatch;
          }
        }

        return "";
      }

      return findNestedMetadataText(item);
    }

    function buildArchiveSelectedMetadataFilename(now = new Date()) {
      const isoDate = now.toISOString().slice(0, 10);
      return `save-sora-selected-metadata-${isoDate}.txt`;
    }

    function getArchiveFolderImageCandidate(item) {
      if (!item) {
        return null;
      }

      if (
        item.sourcePage === "characters" &&
        typeof item.characterAccountProfilePictureUrl === "string" &&
        item.characterAccountProfilePictureUrl
      ) {
        return {
          folderPath: getArchiveFolderImagePath(item),
          imageUrl: item.characterAccountProfilePictureUrl,
        };
      }

      if (typeof item.creatorProfilePictureUrl === "string" && item.creatorProfilePictureUrl) {
        return {
          folderPath: getArchiveFolderImagePath(item),
          imageUrl: item.creatorProfilePictureUrl,
        };
      }

      return null;
    }

    return {
      getArchiveMediaIdentity,
      getArchiveMediaFolderPath,
      getArchiveFolderImagePath,
      getArchiveCharacterFolderName,
      getArchiveCreatorFolderName,
      getArchiveFilename,
      buildArchiveWorkItems,
      buildArchiveFolderImages,
      buildArchiveSupplementalEntries,
    };
  }

  globalScope.__SAVE_SORA_ARCHIVE_ORGANIZER__ = {
    createArchiveOrganizerHelpers,
  };
})(globalThis);
