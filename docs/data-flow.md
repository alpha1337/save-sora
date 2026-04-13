# Data Flow

## Fetch flow

1. User selects one or more top-level sources.
2. The fetch controller schedules source jobs through the shared hidden-tab pool.
3. The service worker runs the source request inside an authenticated hidden Sora tab.
4. The injected source runner batches cursor pages before returning a batch payload.
5. The app normalizes raw rows into the shared `VideoRow` shape.
6. Draft rows resolve `gen_*` identifiers into final `s_*` `video_id` values during normalization.
7. Normalized rows are committed into the session DB immediately.
8. The UI re-renders progressively from IndexedDB-backed global state.

## Export flow

1. The export controller reads normalized `video_rows` from state.
2. CSV output uses the shared schema for every source type.
3. `raw_payload_json` is included as the audit column.

## Download flow

1. The user selects downloadable rows.
2. The queue stores only `video_id[]`.
3. The download controller resolves queued rows from state.
4. The archive organizer builds the canonical `library/` work plan plus organizer metadata.
5. The ZIP worker fetches `https://soravdl.com/api/proxy/video/${video_id}` for each queued video.
6. Files are written once under `library/`.
7. Organizer manifest and platform scripts are appended to the ZIP.
8. The final archive is downloaded once.
9. Successfully archived `video_id` values are appended into `download_history`.

## Reset flow

- session reset clears session DB stores only
- `download_history` is untouched
- only the explicit settings CTA can clear `download_history`
