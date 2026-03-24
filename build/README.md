# Build Resources

Place Windows branding assets here for production packaging:
- `icon.ico` — generated from `src/renderer/assets/yoinkr-icon.png` via `npm run build:icon` (runs automatically before `dist` / `dist:dir`)
- **`extraResources`** copies `build/icon.ico` → `resources/app-icon.ico` next to the packaged app so the **main process** can load a real on-disk icon for `BrowserWindow` (icons inside `app.asar` are unreliable on Windows).
- The **app exe** icon is embedded via **`resedit`** in **`scripts/after-pack.cjs`** (during packaging) and again by **`npm run embed-exe-icon`** (PE `RT_ICON_GROUP` / `RT_ICON`).
- **`npm run dist`** is a **two-step** Windows build: `electron-builder --win dir` → **`embed-exe-icon`** → **`electron-builder --win nsis --prepackaged release/win-unpacked`**. Building NSIS in one shot can still ship an unstamped `Yoinkr.exe`; the extra step guarantees the installer contains the **patched** executable.
- To patch only an existing unpacked folder: **`npm run embed-exe-icon`**.
- We keep **`win.signAndEditExecutable: false`** so `electron-builder` does not download the `winCodeSign` bundle (7z extraction can fail without symlink privileges on Windows).
- **NSIS** installer / uninstaller header icons use the same `build/icon.ico` via `nsis.installerIcon` (see `package.json`).
- **`app.setAppUserModelId('com.yoinkr.app')`** in the main process helps the **Windows taskbar** use your branding instead of the generic Electron icon.
- If Explorer still shows a generic icon, clear the Windows icon cache or run `ie4uinit.exe -show` once; the embedded resource is updated on each successful `npm run dist`.
- future installer bitmap assets if custom NSIS branding is added
