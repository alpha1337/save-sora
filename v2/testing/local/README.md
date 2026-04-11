# Local Replay E2E

This directory documents the local-only replay harness for end-to-end development.

## Goal

Replay real captured Sora payloads locally without committing those payloads to GitHub and without shipping them in the extension package.

## Fixture location

Store local payloads outside tracked source:

- `.local-dev/v2-e2e/payloads/`
- `.local-dev/v2-e2e/output/`

The repository `.gitignore` excludes `.local-dev/`.

## Recommended local structure

- `.local-dev/v2-e2e/payloads/profile/`
- `.local-dev/v2-e2e/payloads/drafts/`
- `.local-dev/v2-e2e/payloads/likes/`
- `.local-dev/v2-e2e/payloads/characters/`
- `.local-dev/v2-e2e/payloads/characterAccounts/`
- `.local-dev/v2-e2e/payloads/creators/`
- `.local-dev/v2-e2e/payloads/draft-resolution/`
- `.local-dev/v2-e2e/payloads/detail-html/`

## Replay expectations

A local replay harness should:

- load captured payload pages by source and pagination step
- replay draft-resolution payloads for `gen_* -> s_*`
- replay detail HTML fallback payloads when needed
- run the real React app, real store, real IndexedDB, CSV export, organizer generation, and ZIP worker
- write artifacts into `.local-dev/v2-e2e/output/`
- never be bundled into `dist`
- never be used by GitHub workflows

## Suggested local scenarios

- one scenario per top-level source type
- mixed-source fetch through the shared pool
- skipped multi-attachment posts
- draft resolution to final `s_*` ids
- CSV export verification
- ZIP creation verification
- organizer manifest and platform script verification
- append-only `download_history` verification
