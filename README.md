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

- `index.html`: Responsive GitHub Pages landing page for product overview, documentation links, repository links, and support/contact details.
- `manifest.json`: Declares permissions, host access, the popup, and the background service worker.
- `background.js`: Owns extension state, opens the inactive Sora tab, injects packaged code into that tab, fetches Sora data through the user's existing session, and manages the download queue.
- `popup.html`, `popup.css`: Define the popup shell and styles.
- `popup.js`: Tiny bootstrap entrypoint that loads the modular popup app.
- `popup/`: Popup modules split by concern so the flow is easy to follow end-to-end:
  - `controllers/`: Event handlers, selection persistence, and settings actions.
  - `ui/list/`: List-level rendering, empty states, and item-card builders.
  - `ui/render/`: Focused helpers for status text, settings synchronization, and control states.
  - `utils/`, `dom.js`, `state.js`, `runtime.js`: Shared helpers, element lookups, popup-local state, and background messaging.
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

## GitHub Pages Notes

- `index.html` is currently a responsive landing page for documentation, project status, repository links, and contact details.
- `privacy.html` is intended to stand on its own as a public privacy policy page on GitHub Pages.
- A standalone web app is disabled for now and has been removed from the project.
- If there is enough support for a dedicated standalone web workflow later, it can be designed and built as a separate follow-up effort.

## Quick Start For Anyone

If you are not technical, this is the easiest way to use Save Sora:

1. Open the GitHub repository page.
2. Click the green `Code` button.
3. Click `Download ZIP`.
4. After the ZIP finishes downloading, unzip it to a normal folder on your computer.
5. Open Chrome and go to `chrome://extensions`.
6. Turn on `Developer mode` in the top-right corner.
7. Click `Load unpacked`.
8. Choose the unzipped Save Sora folder.
9. Open Sora in the same Chrome profile and sign in normally.
10. Click the Save Sora extension icon to load your items and start choosing what you want to download.

You do not need to type commands or edit code just to use the extension.

Important:

- Use a desktop or laptop computer with Chrome.
- The GitHub page is for documentation and privacy information. The working product is the Chrome extension.
- Save Sora uses your existing logged-in Sora browser session. It does not ask you to paste passwords, tokens, or cookies.

## Everyday Use

Once the extension is installed, the normal flow is:

1. Open Chrome and make sure you are signed in to Sora.
2. Click the Save Sora extension icon.
3. Choose `Published`, `Drafts`, or `Both`.
4. Wait while the extension loads your list.
5. Search, sort, or rename items if you want to organize them first.
6. Check only the videos you want to keep.
7. Start the download and let Chrome save the selected files to your computer.

The extension is designed so you can review first and download only what you actually want.

## If Something Feels Confusing

- If the extension does not show your videos, open Sora in the same Chrome profile first and make sure you are signed in.
- If Chrome asks for permission to download files, allow it so the selected videos can be saved.
- If you are using a phone or tablet, use the GitHub page for reading the docs and privacy policy, then switch to a desktop Chrome browser to use the extension itself.

## Load The Extension In Chrome

If you want the short version, do this:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the unzipped repository folder.

If you have not downloaded the project yet, follow the `Quick Start For Anyone` section above first.

## Build A Distribution Package

Local development still runs directly from the repository root, but releases can
now be packaged into a clean `dist/` output:

1. Run `npm run build:dist`.
2. Load `dist/save-sora/` as the unpacked extension if you want to test the exact release build.
3. Upload `dist/save-sora-v<version>.zip` when you want a packaged handoff artifact.

The distribution build intentionally includes only the extension runtime files:

- `manifest.json`
- `background.js`
- `popup.html`, `popup.css`, `popup.js`
- `popup/` modules
- Only the asset files referenced by the extension itself

The GitHub Pages landing page, `privacy.html`, screenshots, and other non-runtime
project files stay in the repository but are not bundled into the extension
release package.

## Development Notes

- No build step is required for local development.
- `npm run build:dist` creates a release-ready `dist/save-sora/` folder and a versioned zip archive.
- The extension is intentionally plain HTML, CSS, and JavaScript.
- The background worker is the source of truth for scan state, selection state, and download progress.
- The popup is designed to be disposable and can be reopened while a scan or download continues.
- The popup code is intentionally split into small modules so an open-source handoff is easier to follow end-to-end.
- The codebase is heavily commented because this project is intended to be inspectable by users, contributors, and reviewers.

## Contact

- Email: `caseyjardin@gmail.com`
- Discord: `for.fox.sake`
- Repository: <https://github.com/alpha1337/save-sora>

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
