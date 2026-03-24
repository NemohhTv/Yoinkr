import { app, BrowserWindow, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const resolveIcon = (): string | undefined => {
  const candidates = [
    join(app.getAppPath(), 'build/icon.ico'),
    join(app.getAppPath(), '../build/icon.ico'),
    join(__dirname, '../../build/icon.ico'),
  ];
  return candidates.find((p) => existsSync(p));
};

export const createMainWindow = async (): Promise<BrowserWindow> => {
  const iconPath = resolveIcon();

  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 760,
    show: false,
    backgroundColor: '#0b0f17',
    title: 'Yoinkr',
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
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
