import { AppPathsService } from './paths/app-paths-service';
import { logger } from './logging/logger';
import { DatabaseService } from './database/database-service';
import { DownloadDraftRepository } from './database/download-draft-repository';
import { DownloadHistoryRepository } from './database/download-history-repository';
import { SettingsRepository } from './settings/settings-repository';
import { SettingsValidator } from './settings/settings-validator';
import { SettingsService } from './settings/settings-service';
import { ToolPathRepository } from './tools/tool-path-repository';
import { MediaToolFacade } from './tools/media-tool-facade';
import { BinaryResolver } from './tools/binary-resolver';
import { ToolStatusService } from './tools/tool-status-service';
import { ToolDownloadService } from './tools/tool-download-service';
import { YtDlpDownloadService } from './tools/yt-dlp-download-service';
import { MetadataCache } from './tools/metadata-cache';
import { YtDlpMetadataService } from './tools/yt-dlp-metadata-service';
import { ProcessRunner } from './shared/process-runner';
import { EditorFileService } from './editor/editor-file-service';
import { FfprobeAnalysisService } from './editor/ffprobe-analysis-service';
import { FfmpegExportService } from './editor/ffmpeg-export-service';
import { ExportPlanningService } from './editor/export-planning-service';
import { TimelineAssetsService } from './editor/timeline-assets-service';
import { EditorPreviewService } from './editor/editor-preview-service';

export interface AppContext {
  logger: typeof logger;
  pathsService: AppPathsService;
  databaseService: DatabaseService;
  downloadDraftRepository: DownloadDraftRepository;
  downloadHistoryRepository: DownloadHistoryRepository;
  settingsService: SettingsService;
  editorFileService: EditorFileService;
  ffprobeAnalysisService: FfprobeAnalysisService;
  exportPlanningService: ExportPlanningService;
  timelineAssetsService: TimelineAssetsService;
  ffmpegExportService: FfmpegExportService;
  editorPreviewService: EditorPreviewService;
  mediaToolFacade: MediaToolFacade;
  toolDownloadService: ToolDownloadService;
  ytDlpDownloadService: YtDlpDownloadService;
}

export const createAppContext = (): AppContext => {
  const pathsService = new AppPathsService();
  const databaseService = new DatabaseService(pathsService.getPaths().databasePath);
  const downloadDraftRepository = new DownloadDraftRepository(databaseService.connection);
  const downloadHistoryRepository = new DownloadHistoryRepository(databaseService.connection);
  const settingsRepository = new SettingsRepository(databaseService.connection);
  const settingsValidator = new SettingsValidator();
  const settingsService = new SettingsService(settingsRepository, settingsValidator, pathsService);
  const toolPathRepository = new ToolPathRepository(databaseService.connection);
  const processRunner = new ProcessRunner();
  const binaryResolver = new BinaryResolver(pathsService);
  const metadataCache = new MetadataCache();
  const editorFileService = new EditorFileService(pathsService, settingsService);
  const ffprobeAnalysisService = new FfprobeAnalysisService(processRunner, binaryResolver);
  const exportPlanningService = new ExportPlanningService(ffprobeAnalysisService);
  const timelineAssetsService = new TimelineAssetsService(pathsService, processRunner, binaryResolver);
  const ffmpegExportService = new FfmpegExportService(pathsService, binaryResolver, ffprobeAnalysisService, exportPlanningService);
  const editorPreviewService = new EditorPreviewService(pathsService, binaryResolver);
  const ytDlpService = new YtDlpMetadataService(processRunner, binaryResolver, metadataCache, pathsService);
  const toolStatusService = new ToolStatusService(processRunner, binaryResolver);
  const mediaToolFacade = new MediaToolFacade(ytDlpService, toolStatusService, settingsService, toolPathRepository);
  const toolDownloadService = new ToolDownloadService(pathsService, processRunner);
  const ytDlpDownloadService = new YtDlpDownloadService(pathsService, binaryResolver);

  return {
    logger,
    pathsService,
    databaseService,
    downloadDraftRepository,
    downloadHistoryRepository,
    settingsService,
    editorFileService,
    ffprobeAnalysisService,
    exportPlanningService,
    timelineAssetsService,
    ffmpegExportService,
    editorPreviewService,
    mediaToolFacade,
    toolDownloadService,
    ytDlpDownloadService,
  };
};
