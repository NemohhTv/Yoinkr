import { AppPathsService } from './paths/app-paths-service';
import { logger } from './logging/logger';
import { DatabaseService } from './database/database-service';
import { DownloadDraftRepository } from './database/download-draft-repository';
import { SettingsRepository } from './settings/settings-repository';
import { SettingsValidator } from './settings/settings-validator';
import { SettingsService } from './settings/settings-service';
import { ToolPathRepository } from './tools/tool-path-repository';
import { MediaToolFacade } from './tools/media-tool-facade';
import { BinaryResolver } from './tools/binary-resolver';
import { ToolStatusService } from './tools/tool-status-service';
import { ToolDownloadService } from './tools/tool-download-service';
import { MetadataCache } from './tools/metadata-cache';
import { YtDlpMetadataService } from './tools/yt-dlp-metadata-service';
import { ProcessRunner } from './shared/process-runner';

export interface AppContext {
  logger: typeof logger;
  pathsService: AppPathsService;
  databaseService: DatabaseService;
  downloadDraftRepository: DownloadDraftRepository;
  settingsService: SettingsService;
  mediaToolFacade: MediaToolFacade;
  toolDownloadService: ToolDownloadService;
}

export const createAppContext = (): AppContext => {
  const pathsService = new AppPathsService();
  const databaseService = new DatabaseService(pathsService.getPaths().databasePath);
  const downloadDraftRepository = new DownloadDraftRepository(databaseService.connection);
  const settingsRepository = new SettingsRepository(databaseService.connection);
  const settingsValidator = new SettingsValidator();
  const settingsService = new SettingsService(settingsRepository, settingsValidator, pathsService);
  const toolPathRepository = new ToolPathRepository(databaseService.connection);
  const processRunner = new ProcessRunner();
  const binaryResolver = new BinaryResolver(pathsService);
  const metadataCache = new MetadataCache();
  const ytDlpService = new YtDlpMetadataService(processRunner, binaryResolver, metadataCache);
  const toolStatusService = new ToolStatusService(processRunner, binaryResolver);
  const mediaToolFacade = new MediaToolFacade(ytDlpService, toolStatusService, settingsService, toolPathRepository);
  const toolDownloadService = new ToolDownloadService(pathsService, processRunner);

  return {
    logger,
    pathsService,
    databaseService,
    downloadDraftRepository,
    settingsService,
    mediaToolFacade,
    toolDownloadService,
  };
};
