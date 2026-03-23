import type { AppContext } from '@main/services/app-context';

import { registerAppIpc } from './register-app-ipc';
import { registerSettingsIpc } from './register-settings-ipc';
import { registerDownloaderIpc } from './register-downloader-ipc';
import { registerToolsIpc } from './register-tools-ipc';
import { registerDiagnosticsIpc } from './register-diagnostics-ipc';

export const registerIpc = (context: AppContext): void => {
  registerAppIpc(context);
  registerSettingsIpc(context);
  registerDownloaderIpc(context);
  registerToolsIpc(context);
  registerDiagnosticsIpc(context);
};
