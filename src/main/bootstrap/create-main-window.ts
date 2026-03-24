import { app, BrowserWindow, nativeImage, shell } from 'electron';
import type { NativeImage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Packaged apps load the window/taskbar icon from a real file on disk.
 * Paths inside `app.asar` are unreliable with `nativeImage.createFromPath` on Windows.
 * `extraResources` copies `build/icon.ico` → `resources/app-icon.ico` at build time.
 */
const resolveWindowIcon = (): NativeImage | undefined => {
  const candidates: string[] = [];

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app-icon.ico'));
  }

  candidates.push(
    join(app.getAppPath(), 'build', 'icon.ico'),
    join(app.getAppPath(), '..', 'build', 'icon.ico'),
    join(__dirname, '../../build/icon.ico'),
  );

  const iconPath = candidates.find((p) => existsSync(p));
  if (!iconPath) {
    return undefined;
  }

  try {
    /** Prefer buffer load — works for ASAR-packed copies and plain files. */
    return nativeImage.createFromBuffer(readFileSync(iconPath));
  } catch {
    try {
      return nativeImage.createFromPath(iconPath);
    } catch {
      return undefined;
    }
  }
};

export const createMainWindow = async (): Promise<BrowserWindow> => {
  const icon = resolveWindowIcon();

  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 760,
    show: false,
    backgroundColor: '#0b0f17',
    title: 'Yoinkr',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    const raw = process.env['ELECTRON_RENDERER_URL'];
    const devUrl = new URL(raw);
    devUrl.hash = '#/downloader';
    await window.loadURL(devUrl.href);
  } else {
    const indexPath = join(__dirname, '../renderer/index.html');
    await window.loadURL(`${pathToFileURL(indexPath).href}#/downloader`);
  }

  return window;
};
