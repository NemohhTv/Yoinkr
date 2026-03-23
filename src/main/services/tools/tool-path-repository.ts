import type Database from 'better-sqlite3';

import type { BinaryStatus } from '@shared/types/common';

interface ToolPathRow {
  tool_name: BinaryStatus['toolName'];
  mode: BinaryStatus['mode'];
  custom_path: string | null;
  detected_path: string | null;
  version_text: string | null;
}

export class ToolPathRepository {
  constructor(private readonly database: Database.Database) {}

  getRows(): ToolPathRow[] {
    return this.database.prepare('SELECT tool_name, mode, custom_path, detected_path, version_text FROM tool_paths').all() as ToolPathRow[];
  }

  upsert(status: BinaryStatus): void {
    this.database.prepare(`
      INSERT INTO tool_paths (tool_name, mode, custom_path, detected_path, version_text, checked_at)
      VALUES (@tool_name, @mode, @custom_path, @detected_path, @version_text, @checked_at)
      ON CONFLICT(tool_name) DO UPDATE SET
        mode = excluded.mode,
        custom_path = excluded.custom_path,
        detected_path = excluded.detected_path,
        version_text = excluded.version_text,
        checked_at = excluded.checked_at
    `).run({
      tool_name: status.toolName,
      mode: status.mode,
      custom_path: status.mode === 'custom' ? status.resolvedPath : null,
      detected_path: status.mode === 'auto-detect' ? status.resolvedPath : null,
      version_text: status.versionText,
      checked_at: new Date().toISOString(),
    });
  }
}
