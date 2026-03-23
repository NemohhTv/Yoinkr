# Build Resources

Place Windows branding assets here for production packaging:
- `icon.ico` for the installer and app executable
- future installer bitmap assets if custom NSIS branding is added

Local Windows installer builds with `electron-builder` may require either:
- Windows Developer Mode enabled, or
- an elevated terminal

That requirement comes from `electron-builder` extracting `winCodeSign` archives containing symbolic links.
