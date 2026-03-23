# Build Resources

Place Windows branding assets here for production packaging:
- `icon.ico` — generated from `src/renderer/assets/yoinkr-icon.png` via `npm run build:icon` (runs automatically before `dist` / `dist:dir`)
- The exe icon is applied in `scripts/after-pack.cjs` using `rcedit`, because `signAndEditExecutable: false` avoids winCodeSign symlink issues on Windows while still embedding this icon.
- future installer bitmap assets if custom NSIS branding is added

Local Windows installer builds with `electron-builder` may require either:
- Windows Developer Mode enabled, or
- an elevated terminal

That requirement comes from `electron-builder` extracting `winCodeSign` archives containing symbolic links.
