# ClipForge Studio

ClipForge Studio is a Windows-first Electron desktop app for fast download-to-edit media workflows. This repository currently implements Phase 1 only: the desktop shell, React + TypeScript UI scaffold, SQLite-backed settings, typed IPC architecture, managed app folders, and placeholder `yt-dlp` / `FFmpeg` service boundaries.

## Phase 1 Scope

Implemented:
- Electron app shell with secure preload bridge
- React + TypeScript renderer scaffold
- modular folder structure for `main`, `preload`, `renderer`, and `shared`
- SQLite bootstrap with baseline tables for settings, drafts, tool paths, and acknowledgements
- dedicated renderer API/client layer wrapping all preload calls
- downloader screen UI scaffold with typed placeholder flows
- settings screen with persisted preferences and native folder / binary pickers
- Windows packaging baseline with `electron-builder`

Deferred to Phase 2+:
- real `yt-dlp` metadata extraction and downloads
- playlist handling, queue execution, and progress parsing
- cookie/session import or browser extraction
- media library indexing
- editor timeline, waveform, thumbnails, and export workflows
- worker-process media jobs

## Architecture

Strict separation is enforced between:
- UI state: React pages, presentational components, and feature controllers in `src/renderer`
- IPC client layer: typed wrappers in `src/renderer/lib/api`
- main-process services: filesystem, SQLite, settings, and tool facades in `src/main/services`

UI components do not call preload or IPC directly. They consume controller state and callbacks only.

## Project Structure

```text
src/
  main/
    bootstrap/
    ipc/
    services/
  preload/
  renderer/
    app/
    components/
    features/
    lib/api/
    routes/
    stores/
  shared/
    constants/
    contracts/
    types/
```

## Development

Prerequisites:
- Node.js LTS

Install:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Run quality checks:

```bash
npm run lint
npm run build
```

## Windows Packaging

Build installer:

```bash
npm run dist
```

Build portable package:

```bash
npm run dist:portable
```

Artifacts are written to `release/`.
If `electron-builder` fails locally with a symlink privilege error while extracting `winCodeSign`, enable Windows Developer Mode or run the packaging command from an elevated terminal.

## Settings and Storage

ClipForge Studio bootstraps managed folders for:
- downloads
- exports
- temp jobs
- projects
- thumbnails
- waveforms
- logs
- cache

SQLite stores:
- settings
- download drafts
- tool path configuration
- recent directories
- legal acknowledgements

## Safety Notes

- Use ClipForge Studio only for content you own or are authorized to use.
- The app is not intended to bypass DRM, CAPTCHA, paywalls, or platform protections.
- Future authenticated access will rely on the user's own authorized logged-in browser session only.
- Replace workflows will require explicit safeguards in later phases.

## Next Planned Expansion

Phase 2 will connect the existing contracts to:
- real `yt-dlp` metadata and download execution
- queue lifecycle management
- binary version probing
- richer history and diagnostics
- library ingestion groundwork for the editor phase
