import { app } from 'electron';

import { createMainWindow } from './bootstrap/create-main-window';
import { registerIpc } from './ipc/register-ipc';
import { createAppContext } from './services/app-context';

const bootstrap = async (): Promise<void> => {
  app.setName('Yoinkr');

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.whenReady().then(async () => {
    const context = createAppContext();
    registerIpc(context);
    await createMainWindow();

    app.on('activate', async () => {
      if (process.platform === 'darwin' && app.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};

void bootstrap();
