import type Database from 'better-sqlite3';

import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/settings';

interface SettingRow {
  key: keyof AppSettings;
  value_json: string;
}

export class SettingsRepository {
  constructor(private readonly database: Database.Database) {}

  getAll(): Partial<AppSettings> {
    const rows = this.database.prepare('SELECT key, value_json FROM app_settings').all() as SettingRow[];
    const settings: Partial<AppSettings> = {};

    for (const row of rows) {
      settings[row.key] = JSON.parse(row.value_json) as AppSettings[keyof AppSettings];
    }

    return settings;
  }

  save(settings: AppSettings): void {
    const statement = this.database.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (@key, @value_json, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);

    const saveMany = this.database.transaction((entries: Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>) => {
      const updatedAt = new Date().toISOString();
      for (const [key, value] of entries) {
        statement.run({
          key,
          value_json: JSON.stringify(value),
          updated_at: updatedAt,
        });
      }
    });

    saveMany(Object.entries(settings) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>);
  }

  reset(): void {
    this.database.prepare('DELETE FROM app_settings').run();
    this.save(DEFAULT_SETTINGS);
  }
}
