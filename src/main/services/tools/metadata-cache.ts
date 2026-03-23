import type { DownloadMetadata } from '@shared/types/downloader';

interface MetadataCacheEntry {
  metadata: DownloadMetadata;
  cachedAt: number;
}

export class MetadataCache {
  private readonly entries = new Map<string, MetadataCacheEntry>();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  get(normalizedUrl: string): DownloadMetadata | null {
    const entry = this.entries.get(normalizedUrl);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.entries.delete(normalizedUrl);
      return null;
    }

    return entry.metadata;
  }

  set(normalizedUrl: string, metadata: DownloadMetadata): void {
    this.entries.set(normalizedUrl, {
      metadata,
      cachedAt: Date.now(),
    });
  }
}
