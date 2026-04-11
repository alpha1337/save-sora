# V2 Architecture

## Runtime split

V2 is a fullscreen-only MV3 extension.

- The React application in `v2/src/` owns user-visible state, IndexedDB session persistence, CSV export, organizer manifest generation, and ZIP worker orchestration.
- The service worker in `v2/background/` owns only extension-native responsibilities: opening/focusing the app tab, managing hidden Sora tabs, and relaying source requests into the injected fetch runtime.
- The injected runtime in `v2/injected/` executes source fetch jobs inside authenticated Sora tabs.
- The ZIP worker in `v2/workers/zip.worker.ts` fetches final `s_*` media blobs and emits the archive bytes back to the app.

## Data model

V2 uses two IndexedDB databases.

### Session DB

Resettable working-session data:

- `settings`
- `session_meta`
- `video_rows`
- `download_queue`
- `draft_resolution_cache`

### Download History DB

Permanent append-only history:

- store: `download_history`
- key: `video_id`

`download_history` is intentionally isolated so normal reset flows cannot clear it. Only the settings clear-history CTA calls the destructive helper.

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
- draft `gen_* -> s_*` resolution during normalization, never during download
- bounded detail fallback concurrency: `4`

## Download model

- queue stores only resolved `video_id[]`
- each downloadable row maps to one final `s_*` id
- multi-attachment posts are excluded in v2
- ZIP worker blob-fetch concurrency: `4`
- the archive stores each media file once in `library/`
- organizer views are rebuilt after extraction using the bundled platform scripts
