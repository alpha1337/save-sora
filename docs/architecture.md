# Architecture

## Runtime split

Save Sora is a fullscreen-only MV3 extension.

- The React application in `src/` owns user-visible state, IndexedDB session persistence, CSV export, organizer manifest generation, and ZIP worker orchestration.
- The service worker in `background/` owns extension-native responsibilities: opening/focusing the app tab, managing hidden Sora tabs, and relaying source requests into the injected fetch runtime.
- The injected runtime in `injected/` executes source fetch jobs inside authenticated Sora tabs.
- The ZIP worker in `workers/zip.worker.ts` fetches final `s_*` media blobs and emits archive bytes back to the app.

## Data model

Save Sora uses one flattened IndexedDB database:

- db: `save-sora-v3`
- stores:
  - `download_history`
  - `settings`
  - `saved_accounts`
    - indexes: `creators`, `side_characters`
  - `cursor_checkpoints`
  - `job_rows`
    - indexes: `by_job_id`, `by_row_id`, `by_updated_at`
  - `rows`

## UI rules

The UI follows Atomic Design:

- atoms: primitives only
- molecules: small compositions
- organisms: feature panels
- templates: layout only

All visual components are stateless and prop-driven. Controllers and services own orchestration.

## Fetching model

Top-level sources are mapped onto a shared fetch pipeline:

- generic paginated runner
- generic composite runner
- small source-adapter set

Confirmed performance decisions:

- hidden-tab pool size: `3`
- in-tab cursor batching before returning control to the extension
- incremental IndexedDB commits after each normalized batch
- draft `gen_* -> s_*` resolution during download handoff
- bounded detail fallback concurrency: `4`

## Download model

- queue stores only resolved `video_id[]`
- each downloadable row maps to one final `s_*` id
- multi-attachment posts are excluded in the current build
- ZIP worker blob-fetch concurrency: `4`
- the archive stores each media file once in `library/`
- organizer views are rebuilt after extraction using the bundled platform scripts
