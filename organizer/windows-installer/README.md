# Save Sora Organizer Windows Installer

This folder contains a native Windows `.exe` installer source (NSIS) for the organizer launcher.

## Build

1. Install [NSIS](https://nsis.sourceforge.io/Download).
2. In this repo, run:

```bash
npm run build:organizer-installer:win
```

Output:

- `dist/SaveSoraOrganizerSetup.exe`

## End-user flow

1. User runs `SaveSoraOrganizerSetup.exe`.
2. User launches **Save Sora Organizer** from Desktop/Start Menu.
3. App prompts for the extracted Save Sora ZIP folder.
4. Organizer runs `organizer/create-links-windows.ps1` and opens `organized/`.

No duplicate media files are created.
