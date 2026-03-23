import type Database from 'better-sqlite3';

import type { DownloadHistoryRecord } from '@shared/types/downloader';

interface HistoryRow {
  id: string;
  title: string;
  source_url: string;
  thumbnail_url: string;
  extractor: string;
  duration_text: string;
  size_text: string;
  media_type: string;
  file_type: string;
  quality_target: string;
  output_path: string | null;
  completed_at: string;
}

const toRecord = (row: HistoryRow): DownloadHistoryRecord => ({
  id: row.id,
  title: row.title,
  sourceUrl: row.source_url,
  thumbnailUrl: row.thumbnail_url,
  extractor: row.extractor,
  durationText: row.duration_text,
  sizeText: row.size_text,
  mediaType: row.media_type as DownloadHistoryRecord['mediaType'],
  fileType: row.file_type as DownloadHistoryRecord['fileType'],
  qualityTarget: row.quality_target as DownloadHistoryRecord['qualityTarget'],
  outputPath: row.output_path,
  completedAt: row.completed_at,
});

export class DownloadHistoryRepository {
  constructor(private readonly database: Database.Database) {}

  save(record: DownloadHistoryRecord): DownloadHistoryRecord {
    this.database.prepare(`
      INSERT OR REPLACE INTO download_history (
        id, title, source_url, thumbnail_url, extractor,
        duration_text, size_text, media_type, file_type,
        quality_target, output_path, completed_at
      ) VALUES (
        @id, @title, @source_url, @thumbnail_url, @extractor,
        @duration_text, @size_text, @media_type, @file_type,
        @quality_target, @output_path, @completed_at
      )
    `).run({
      id: record.id,
      title: record.title,
      source_url: record.sourceUrl,
      thumbnail_url: record.thumbnailUrl,
      extractor: record.extractor,
      duration_text: record.durationText,
      size_text: record.sizeText,
      media_type: record.mediaType,
      file_type: record.fileType,
      quality_target: record.qualityTarget,
      output_path: record.outputPath,
      completed_at: record.completedAt,
    });
    return record;
  }

  delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM download_history WHERE id = @id').run({ id });
    return result.changes > 0;
  }

  getAll(): DownloadHistoryRecord[] {
    const rows = this.database.prepare(
      'SELECT * FROM download_history ORDER BY completed_at DESC',
    ).all() as HistoryRow[];
    return rows.map(toRecord);
  }

  getById(id: string): DownloadHistoryRecord | null {
    const row = this.database.prepare('SELECT * FROM download_history WHERE id = @id LIMIT 1').get({ id }) as HistoryRow | undefined;
    return row ? toRecord(row) : null;
  }
}
