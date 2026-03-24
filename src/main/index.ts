import './bootstrap/register-fatal-handlers';

import { app, dialog } from 'electron';

import { createMainWindow } from './bootstrap/create-main-window';
import { registerYoinkrMediaProtocol, registerYoinkrMediaSchemePrivileged } from './bootstrap/register-media-protocol';
import { registerIpc } from './ipc/register-ipc';
import { appendStartupLog, STARTUP_LOG_LOCATIONS_MESSAGE } from './bootstrap/register-fatal-handlers';

registerYoinkrMediaSchemePrivileged();

const showStartupError = (error: unknown): void => {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  appendStartupLog(text);
  try {
    dialog.showErrorBox(
      'Yoinkr failed to start',
      `Something went wrong during startup.\n\n${STARTUP_LOG_LOCATIONS_MESSAGE}\n\n---\n${text.slice(0, 900)}`,
    );
  } catch {
    // ignore
  }
};

const bootstrap = async (): Promise<void> => {
  app.setName('Yoinkr');

  if (!app.requestSingleInstanceLock()) {
    // Second launch (e.g. dev while packaged Yoinkr.exe is still running) exits here with no window.
    // eslint-disable-next-line no-console
    console.warn(
      '[Yoinkr] Another instance is already running. Close Yoinkr (Task Manager → Yoinkr) and try again.',
    );
    app.quit();
    return;
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  try {
    await app.whenReady();
    registerYoinkrMediaProtocol();
    // Dynamic import keeps better-sqlite3 out of the initial parse — pairs with asarUnpack in package.json.
    const { createAppContext } = await import('./services/app-context');
    const context = createAppContext();
    registerIpc(context);
    await createMainWindow();

    app.on('activate', async () => {
      if (process.platform === 'darwin' && app.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  } catch (error) {
    showStartupError(error);
    app.exit(1);
  }
};

void bootstrap().catch((error) => {
  showStartupError(error);
  app.exit(1);
});
