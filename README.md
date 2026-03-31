# Save Sora

Save Sora is an open-source Chrome Manifest V3 extension for reviewing and selectively downloading your own Sora published videos and drafts from your existing logged-in browser session.

## Single Purpose

Save Sora helps users review and selectively download their own Sora published videos and drafts from their logged-in Sora account for backup.

Short form:

Review and selectively download your own Sora videos and drafts for backup.

## What The Extension Does

- Opens an inactive Sora tab in the current Chrome profile.
- Runs packaged extension code in that Sora tab with `chrome.scripting`.
- Reads the user's own published videos and drafts from the user's existing logged-in Sora session.
- Builds a local review list inside the popup.
- Lets the user search, rename, select, remove from the set, and re-download items.
- Saves only local extension settings and local UI state with `chrome.storage.local`.
- Downloads only the videos the user explicitly selects with `chrome.downloads`.

## What The Extension Does Not Do

- It does not ask the user to paste tokens, cookies, or credentials.
- It does not send the user's Sora library to a developer-owned server.
- It does not sell or transfer user data to third parties.
- It does not run analytics or telemetry in the current build.
- It does not fetch remote JavaScript or WebAssembly for core extension logic.

## How It Works

The extension has a deliberately small architecture:

- `manifest.json`: Declares permissions, host access, the popup, and the background service worker.
- `background.js`: Owns extension state, opens the inactive Sora tab, injects packaged code into that tab, fetches Sora data through the user's existing session, and manages the download queue.
- `popup.html`, `popup.js`, `popup.css`: Render the review UI and send user actions to the background worker.
- `privacy.html`: Public privacy policy page intended for GitHub Pages or any public static host.
- `assets/`: Icons, screenshots, and UI media.

At runtime, the flow is:

1. The user opens the popup and chooses `Published`, `Drafts`, or `Both`.
2. The background worker opens or reuses an inactive Sora tab.
3. The worker injects packaged code into that tab with `chrome.scripting`.
4. The injected code reads the user's own available Sora items from the current signed-in session.
5. The worker stores a local working set in `chrome.storage.local`.
6. The popup renders the list and lets the user selectively download the items they want.
7. The background worker saves those selected files with `chrome.downloads`.

## Local-Only Data Handling

The current build is designed so that user data stays in the browser:

- The extension uses the user's existing logged-in Sora session already present in Chrome.
- Sora titles, prompts, thumbnails, metadata, and download URLs are processed locally in the extension.
- Auth tokens and cookies are not collected by the developer and are not sent to a separate backend.
- `chrome.storage.local` is used only for extension settings and local state such as theme, default source, sort order, renamed titles, selection state, removed state, and downloaded state.
- The Donate tab links to and embeds Ko-fi content, which is separate from the extension's core logic.

Important nuance:

The extension does derive the auth context already present in the user's own Sora tab so it can fetch the user's own data. That is different from collecting credentials from the user or transmitting them to the developer. The auth context is used locally, inside the browser session, for the extension's single purpose.

## Chrome Web Store Privacy And Practices Answers

This section mirrors the current manifest and implementation so the store listing, privacy policy, and codebase stay aligned.

### Single Purpose

Use:

Save Sora helps users review and selectively download their own Sora published videos and drafts from their logged-in Sora account for backup.

Tighter option:

Review and selectively download your own Sora videos and drafts for backup.

### Permission Justifications

| Permission | Why it is needed |
| --- | --- |
| `downloads` | Used to save the Sora videos the user selects to their device. |
| `scripting` | Used to run packaged extension code inside a Sora tab so the extension can read the user's own published videos and drafts from their existing logged-in Sora session. |
| `storage` | Used to save local-only extension settings and state, such as theme, default source, sort order, renamed titles, selection state, and downloaded state. |
| `tabs` | Used to open and manage an inactive Sora tab so the extension can load Sora, wait for the page to be ready, and fetch the user's own videos from their logged-in session. |

### Host Permission Justifications

Host access is limited to the domains required for the extension's single purpose:

| Host permission | Why it is needed |
| --- | --- |
| `https://sora.chatgpt.com/*` | Access the user's own Sora published videos and drafts from the user's logged-in session. |
| `https://videos.openai.com/*` | Download and preview Sora video files selected by the user. |
| `https://ogimg.chatgpt.com/*` | Display preview thumbnails in the review list. |

### Remote Code

Recommended answer for the current build:

No, I am not using remote code.

Why:

- The extension's core logic is packaged locally in the extension bundle.
- The background worker, popup scripts, and injected Sora-fetch code all ship inside the extension package.
- The current Donate tab embeds a Ko-fi iframe, but that is third-party page content, not remotely loaded extension logic.

Reviewer note:

The Ko-fi iframe is not the same as remote extension code, but it can still create extra review questions because it introduces third-party embedded content on an extension page.

### Data Usage

Conservative answer for the current build:

Check `Website content`.

Leave the other data-use boxes unchecked unless the product later adds analytics, telemetry, or server-side collection.

Why `Website content` applies:

The extension reads Sora titles, prompts, thumbnails, metadata, and downloadable video references from the user's Sora account so the user can review and download their own files.

### Certifications

If still true at submission time, the current codebase supports checking all three:

- I do not sell or transfer user data to third parties.
- I do not use or transfer user data for purposes unrelated to the extension's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy Policy Summary

The public privacy policy should clearly say:

- The extension uses the user's logged-in Sora session.
- Selected video and account content is processed locally in the browser.
- No auth tokens or cookies are collected by the developer.
- No user data is sold or shared.
- Local storage is used only for settings and extension state.
- The Donate tab links to and embeds Ko-fi.

This repository includes that policy in `privacy.html`.

## Load The Extension In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder.

## Development Notes

- No build step is required for the current codebase.
- The extension is intentionally plain HTML, CSS, and JavaScript.
- The background worker is the source of truth for scan state, selection state, and download progress.
- The popup is designed to be disposable and can be reopened while a scan or download continues.
- The codebase is heavily commented because this project is intended to be inspectable by users, contributors, and reviewers.

## Open-Source Review Notes

Two implementation details are especially important for reviewers and contributors:

- The extension uses the user's existing signed-in Sora session locally. That should be described carefully in public docs so it is clear the extension is not collecting credentials from the user.
- The current Donate tab embeds Ko-fi. That is not remote extension logic, but it is still third-party embedded content and may attract Chrome Web Store reviewer attention.

## Official References

These are the primary Google docs that informed the permission and privacy justifications above:

- Chrome Web Store Program Policies: <https://developer.chrome.com/docs/webstore/program-policies/>
- Chrome Web Store user data guidance: <https://developer.chrome.com/docs/webstore/user-data/>
- Declaring extension permissions: <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions/>
- Cross-origin network requests and host access: <https://developer.chrome.com/docs/extensions/develop/concepts/network-requests/>
- `chrome.scripting` API: <https://developer.chrome.com/docs/extensions/reference/api/scripting/>
- Extension distribution and hosted code guidance: <https://developer.chrome.com/docs/extensions/mv3/hosting>
