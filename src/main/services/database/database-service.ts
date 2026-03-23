import Database from 'better-sqlite3';

export class DatabaseService {
  private database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.migrate();
  }

  get connection(): Database.Database {
    return this.database;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS download_drafts (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        requested_format_json TEXT NOT NULL,
        requested_output_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_paths (
        tool_name TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        custom_path TEXT,
        detected_path TEXT,
        version_text TEXT,
        checked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS recent_directories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        last_used_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS legal_acknowledgements (
        key TEXT PRIMARY KEY,
        accepted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS download_history (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL DEFAULT '',
        extractor TEXT NOT NULL DEFAULT '',
        duration_text TEXT NOT NULL DEFAULT '',
        size_text TEXT NOT NULL DEFAULT '',
        media_type TEXT NOT NULL DEFAULT 'video-audio',
        file_type TEXT NOT NULL DEFAULT 'mp4',
        quality_target TEXT NOT NULL DEFAULT 'best',
        output_path TEXT,
        completed_at TEXT NOT NULL
      );
    `);
  }
}
