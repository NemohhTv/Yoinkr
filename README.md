<p align="center">
  <img src="docs/readme-header.png" alt="Yoinkr — grab, clip, export" width="520" />
</p>

<p align="center">
  <strong>Windows-first desktop app for download → edit media workflows</strong>
</p>

<p align="center">
  <a href="https://github.com/NemohhTv/Yoinkr/releases/latest"><img src="https://img.shields.io/github/v/release/NemohhTv/Yoinkr?label=latest%20release&logo=github" alt="Latest release" /></a>
  &nbsp;
  <img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" alt="License: UNLICENSED" />
</p>

---

## What it does

| Area | What you get |
|------|----------------|
| **Downloader** | Paste URLs (e.g. YouTube), validate, preview metadata, queue downloads with **yt-dlp** — quality, container, audio options, optional **cookies** where supported. |
| **Editor** | Open local files, trim on a timeline, export with **FFmpeg** and progress feedback. |
| **Settings** | Folders, tool paths or bundled **yt-dlp / FFmpeg**, cookie modes, diagnostics. Packaged **NSIS** installs can **check for updates** from GitHub Releases. |

Stack: **Electron** + **React** + **TypeScript**, typed IPC, local persistence for settings and history.

---

## Download

Official builds live on **[GitHub Releases](https://github.com/NemohhTv/Yoinkr/releases/latest)**.

1. Open the **latest** release (or pick a version tag).  
2. Under **Assets**, download:
   - **`Yoinkr-Setup-x.x.x.exe`** — recommended NSIS installer (Start menu; supports in-app updates).  
   - **`Yoinkr-x.x.x.exe`** — portable; in-app auto-update is **disabled** for portable builds.

`latest.yml` and `.blockmap` are for the updater; you normally only need the **Setup** exe.

**Example URL** (replace the version with the tag you want):  
`https://github.com/NemohhTv/Yoinkr/releases/download/v0.2.13/Yoinkr-Setup-0.2.13.exe`

---

## Development

**Prerequisites:** Node.js LTS, **Windows** (primary target).

```bash
npm install
npm run dev
```

| Script | Purpose |
|--------|---------|
| `npm run build` | Typecheck + production bundles |
| `npm run lint` | ESLint |
| `npm run dist` | NSIS + unpacked under `release/` |
| `npm run dist:portable` | Portable exe |

If `electron-builder` hits symlink issues on Windows, enable **Developer Mode** or run the terminal elevated.

---

## Releases & CI

Pushing a tag **`v*`** that matches `"version"` in `package.json` runs **[`.github/workflows/release.yml`](.github/workflows/release.yml)** — Windows build + publish to the GitHub release (`latest.yml`, installers).

```bash
# bump package.json version, then:
git add -A && git commit -m "chore: release 0.2.13"
git push origin main
git tag v0.2.13 && git push origin v0.2.13
```

---

## Repository layout

```text
src/
  main/       bootstrap, IPC, services (downloads, editor, tools, updates)
  preload/    typed bridge
  renderer/   app shell, features, API client
  shared/     types, contracts
docs/         README branding assets
```

---

## Safety & legal

Use Yoinkr only for content you own or are allowed to download and edit. The app is not intended to bypass DRM, paywalls, or platform protections. Cookie features are for passing **your own** session data to yt-dlp where supported.

---

## License

See **`package.json`** (`license` field).
