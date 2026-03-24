# Yoinkr

**Yoinkr** is a Windows-first Electron desktop app for **download → edit** media workflows: a **Downloader** powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp), an **Editor** for trimming and export (FFmpeg), and **Settings** for folders, cookies, and bundled tools. The UI is React + TypeScript; the main process uses typed IPC, SQLite for settings/history, and `electron-builder` for Windows installers.

**Repository:** [github.com/NemohhTv/Yoinkr](https://github.com/NemohhTv/Yoinkr)

---

## Download the installer (latest release)

Official builds are published as **GitHub Releases** (NSIS installer + portable + update metadata).

1. Open **Releases**: **[https://github.com/NemohhTv/Yoinkr/releases](https://github.com/NemohhTv/Yoinkr/releases)**  
2. Open the **latest** release (or pick a tag, e.g. **v0.2.6**).  
3. Under **Assets**, download (names use **hyphens**, as built by CI):
   - **`Yoinkr-Setup-x.x.x.exe`** — recommended: NSIS installer (Start menu entry; supports in-app updates from GitHub).  
   - **`Yoinkr-x.x.x.exe`** — portable; in-app auto-update is disabled for portable builds.  
   - **`latest.yml`** + **`.blockmap`** — used by the app updater; you normally only download the **Setup** exe.

**Direct link to the latest release page:**  
[https://github.com/NemohhTv/Yoinkr/releases/latest](https://github.com/NemohhTv/Yoinkr/releases/latest)

**Example (replace version with the tag you want):**  
`https://github.com/NemohhTv/Yoinkr/releases/download/v0.2.6/Yoinkr-Setup-0.2.6.exe`

After installing from the **Setup** exe, Yoinkr can **check for updates** from the sidebar (GitHub Releases). Building the installer locally with `npm run dist` also works; updates still use the same GitHub feed when `owner` / `repo` match this repository.

---

## Features

- **Downloader** — Paste URLs (e.g. YouTube), validate, fetch metadata, queue items, download with **yt-dlp** (progress, merge, remux). Quality, container, and audio preferences; optional **cookies** (file, browser, or pasted) for restricted content where allowed.
- **Editor** — Open local media, timeline segments, export via **FFmpeg** with progress.
- **Settings** — Download/export/temp folders, overwrite behavior, **yt-dlp / FFmpeg** discovery or bundled downloads, YouTube cookie modes, diagnostics paths.
- **Updates** — Packaged app checks **GitHub Releases** for newer versions (installer track). Portable and dev builds do not use the same auto-update path.

---

## Development

**Prerequisites:** Node.js LTS, Windows (primary target).

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build    # typecheck + production renderer/main bundle
npm run lint
npm run dist              # NSIS + unpacked under release/
npm run dist:portable     # portable exe
```

Artifacts: **`release/`** (e.g. `release/win-unpacked`, `Yoinkr Setup x.x.x.exe`).  
If `electron-builder` hits symlink / permission issues on Windows, enable **Developer Mode** or run the terminal elevated.

---

## Releases & CI

Pushing a **version tag** `v*` that matches `"version"` in `package.json` runs **GitHub Actions** (`.github/workflows/release.yml`): builds Windows targets and **publishes** assets to the release so the app and `electron-updater` can consume **`latest.yml`** and installers.

Typical flow:

1. Bump `"version"` in `package.json` and commit.  
2. `git tag v0.2.6 && git push origin main && git push origin v0.2.6`  
3. Wait for the workflow; then download **`Yoinkr-Setup-0.2.6.exe`** (or whatever version) from **Releases → Assets**.

---

## Architecture

- **Renderer:** React pages and feature controllers; no direct `window` IPC — use `src/renderer/lib/api` (yoinkr client).  
- **Preload:** Exposes a typed `yoinkrApi` bridge.  
- **Main:** Services for downloads, tools, SQLite, settings, editor pipeline, and auto-update.

```text
src/
  main/       bootstrap, ipc, services
  preload/
  renderer/   app, components, features, lib/api, routes, stores
  shared/     constants, contracts, types
```

---

## Storage

Managed folders (downloads, exports, temp, projects, thumbnails, waveforms, logs, cache) and **SQLite** (settings, drafts, tool paths, history, acknowledgements) — see Settings / diagnostics in-app.

---

## Safety & legal

Use Yoinkr only for content you own or are allowed to download and edit. The app is not intended to bypass DRM, CAPTCHA, paywalls, or platform protections. Cookie features are for passing **your own** exported session data to yt-dlp where supported.

---

## License

See `package.json` (`license` field).
