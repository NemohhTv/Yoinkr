import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type { DownloadDraft } from '@shared/types/downloader';

export class DownloadDraftRepository {
  constructor(private readonly database: Database.Database) {}

  create(
    draft: Omit<DownloadDraft, 'id' | 'createdAt' | 'status'>,
  ): DownloadDraft {
    const created: DownloadDraft = {
      ...draft,
      id: randomUUID(),
      status: 'draft',
      createdAt: new Date().toISOString(),
    };

    this.database.prepare(`
      INSERT INTO download_drafts (
        id,
        source_url,
        normalized_url,
        requested_format_json,
        requested_output_json,
        status,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @source_url,
        @normalized_url,
        @requested_format_json,
        @requested_output_json,
        @status,
        @created_at,
        @updated_at
      )
    `).run({
      id: created.id,
      source_url: created.sourceUrl,
      normalized_url: created.normalizedUrl,
      requested_format_json: JSON.stringify({
        qualityTarget: created.qualityTarget,
      }),
      requested_output_json: JSON.stringify({
        outputFormat: created.outputFormat,
        audioOnly: created.audioOnly,
        remuxIfPossible: created.remuxIfPossible,
        allowReencodeFallback: created.allowReencodeFallback,
      }),
      status: created.status,
      created_at: created.createdAt,
      updated_at: created.createdAt,
    });

    return created;
  }
}
