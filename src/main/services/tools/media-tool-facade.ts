import type { BinaryStatus } from '@shared/types/common';
import type { DownloadMetadata, DownloadUrlValidation } from '@shared/types/downloader';
import type { AppSettings } from '@shared/types/settings';

import type { SettingsService } from '../settings/settings-service';
import type { ToolPathRepository } from './tool-path-repository';
import type { ToolStatusService } from './tool-status-service';
import type { YtDlpMetadataService } from './yt-dlp-metadata-service';

export class MediaToolFacade {
  constructor(
    private readonly ytDlpService: YtDlpMetadataService,
    private readonly toolStatusService: ToolStatusService,
    private readonly settingsService: SettingsService,
    private readonly toolPathRepository: ToolPathRepository,
  ) {}

  validateUrls(input: string): DownloadUrlValidation[] {
    return this.ytDlpService.validateUrls(input);
  }

  async getMetadata(url: string): Promise<DownloadMetadata> {
    return this.ytDlpService.getMetadata(url, this.settingsService.getSettings());
  }

  async getBinaryStatuses(settings?: AppSettings): Promise<BinaryStatus[]> {
    const effectiveSettings = settings ?? this.settingsService.getSettings();
    const statuses = await this.toolStatusService.getBinaryStatuses(effectiveSettings);
    statuses.forEach((status) => this.toolPathRepository.upsert(status));
    return statuses;
  }
}
