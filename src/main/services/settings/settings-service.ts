import type { AppPathsService } from '../paths/app-paths-service';
import type { SettingsRepository } from './settings-repository';
import type { SettingsValidator } from './settings-validator';

import type { AppSettings, SettingsPatch } from '@shared/types/settings';

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly validator: SettingsValidator,
    private readonly pathsService: AppPathsService,
  ) {}

  getSettings(): AppSettings {
    const current = this.repository.getAll();
    const defaultsFromPaths = this.getPathDefaults();
    return this.validator.mergeAndValidate({
      ...defaultsFromPaths,
      ...current,
    });
  }

  updateSettings(patch: SettingsPatch): AppSettings {
    const current = this.repository.getAll();
    const merged = this.validator.mergeAndValidate({
      ...this.getPathDefaults(),
      ...current,
    }, patch);

    this.repository.save(merged);
    return merged;
  }

  reset(): AppSettings {
    this.repository.reset();
    return this.getSettings();
  }

  private getPathDefaults(): Pick<AppSettings, 'downloadDirectory' | 'exportDirectory' | 'tempDirectory'> {
    const paths = this.pathsService.getPaths();

    return {
      downloadDirectory: paths.managedDirectories.downloads,
      exportDirectory: paths.managedDirectories.exports,
      tempDirectory: paths.managedDirectories.temp,
    };
  }
}
