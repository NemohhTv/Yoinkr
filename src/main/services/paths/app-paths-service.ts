import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { APP_NAME, MANAGED_DIRECTORY_KEYS, type ManagedDirectoryKey } from '@shared/constants/app';

export interface AppPaths {
  userDataRoot: string;
  databasePath: string;
  binariesPath: string;
  managedDirectories: Record<ManagedDirectoryKey, string>;
}

export class AppPathsService {
  private cachedPaths: AppPaths | null = null;

  getPaths(): AppPaths {
    if (this.cachedPaths) {
      return this.cachedPaths;
    }

    const userDataRoot = join(app.getPath('appData'), APP_NAME);
    const dataRoot = join(userDataRoot, 'data');
    const binariesPath = join(userDataRoot, 'binaries');

    const managedDirectories = {
      downloads: join(app.getPath('videos'), APP_NAME, 'Downloads'),
      exports: join(app.getPath('videos'), APP_NAME, 'Exports'),
      temp: join(app.getPath('temp'), APP_NAME),
      projects: join(app.getPath('documents'), APP_NAME, 'Projects'),
      thumbnails: join(userDataRoot, 'cache', 'thumbnails'),
      waveforms: join(userDataRoot, 'cache', 'waveforms'),
      logs: join(userDataRoot, 'logs'),
      cache: join(userDataRoot, 'cache'),
    } satisfies Record<ManagedDirectoryKey, string>;

    const paths: AppPaths = {
      userDataRoot,
      databasePath: join(dataRoot, 'yoinkr.db'),
      binariesPath,
      managedDirectories,
    };

    [userDataRoot, dataRoot, binariesPath, ...MANAGED_DIRECTORY_KEYS.map((key) => managedDirectories[key])].forEach(
      (targetPath) => this.ensureDirectory(targetPath),
    );

    this.cachedPaths = paths;
    return paths;
  }

  private ensureDirectory(targetPath: string): void {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
  }
}
