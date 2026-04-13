# Save Sora

Save Sora is a Manifest V3 Chrome extension for fetching, reviewing, exporting, and organizing Sora videos in a fullscreen dashboard.

## Runtime Architecture

- `src/`: React app (UI, controllers, store, normalization, ZIP planning)
- `background/`: extension service worker + hidden-tab worker pool
- `injected/`: authenticated Sora-side fetch runtime
- `workers/`: ZIP worker
- `public/`: extension static assets (icons)
- `docs/`: architecture and data flow notes

## Build and Release

- `npm run dev`: run app development server
- `npm run build`: build extension runtime into `.build/`
- `npm run build:dist`: package `dist/save-sora-v<version>.zip`
- `npm run check`: file-size rule, typecheck, lint, tests

## Data Migration Compatibility

This mainline keeps the migration path for users on `1.24.1` and older:

- `src/lib/db/legacy-v1-migration.ts` is still executed during bootstrap.
- Legacy IndexedDB data from `saveSoraVolatileBackup` is read once and migrated.
- Migration metadata is persisted to avoid repeated migrations.

## Organizer

ZIP exports include organizer scripts in `organizer/` inside the archive:

- macOS: `Install Organizer.command`
- Windows: `Run Organizer.bat`

A standalone Windows installer source is available in:

- `organizer/windows-installer/`

Build it on Windows with NSIS installed:

- `npm run build:organizer-installer:win`

## Permissions

The extension uses only permissions required for local session-based fetch + export workflows.
See `manifest.json` for the authoritative permission list.
