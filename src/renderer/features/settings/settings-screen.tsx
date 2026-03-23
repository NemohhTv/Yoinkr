import type { BinaryStatus, DownloadableToolName } from '@shared/types/common';
import type { AppSettings } from '@shared/types/settings';
import type { ToolDownloadState } from './use-settings-controller';

interface SettingsController {
  draft: AppSettings | null;
  binaryStatus: BinaryStatus[];
  diagnostics: {
    appVersion: string;
    userDataPath: string;
    databasePath: string;
    logsPath: string;
    binariesPath: string;
  } | null;
  error: string | null;
  isSaving: boolean;
  downloadStates: Record<DownloadableToolName, ToolDownloadState>;
  updateField: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  pickDirectory: (
    field: 'downloadDirectory' | 'exportDirectory' | 'tempDirectory',
    title: string,
  ) => Promise<void>;
  chooseBinaryPath: (toolName: BinaryStatus['toolName']) => Promise<void>;
  downloadTool: (tool: DownloadableToolName) => Promise<void>;
  save: () => Promise<void>;
  reset: () => Promise<void>;
}

const StatusDot = ({ ready }: { ready: boolean }): JSX.Element => (
  <span className={`tool-status-dot ${ready ? 'ready' : 'missing'}`} />
);

const DownloadProgressBar = ({ progress }: { progress: ToolDownloadState['progress'] }): JSX.Element | null => {
  if (!progress) return null;
  return (
    <div className="tool-progress">
      <div className="tool-progress-track">
        <div className="tool-progress-fill" style={{ width: `${Math.max(2, progress.percent)}%` }} />
      </div>
      <span className="tool-progress-label">{progress.message}</span>
    </div>
  );
};

const ToolCard = ({
  title,
  description,
  status,
  secondaryStatus,
  downloadState,
  onDownload,
  modeValue,
  onModeChange,
  customPaths,
}: {
  title: string;
  description: string;
  status: BinaryStatus | null;
  secondaryStatus?: BinaryStatus | null;
  downloadState: ToolDownloadState;
  onDownload: () => void;
  modeValue: string;
  onModeChange: (value: string) => void;
  customPaths: Array<{ label: string; value: string; onBrowse: () => void }>;
}): JSX.Element => {
  const isReady = status?.status === 'ready';
  const secondaryReady = secondaryStatus ? secondaryStatus.status === 'ready' : undefined;
  const allReady = isReady && (secondaryReady === undefined || secondaryReady);
  const showCustomPaths = modeValue === 'custom';

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <div className="tool-card-title-row">
          <h3>{title}</h3>
          <span className="muted" style={{ fontSize: '0.85rem' }}>{description}</span>
        </div>
      </div>

      <div className="tool-card-status-row">
        {status && (
          <div className="tool-status-item">
            <StatusDot ready={isReady} />
            <strong>{status.toolName}</strong>
            <span className="muted">
              {status.status === 'ready' ? status.versionText ?? 'Ready' : status.status === 'missing' ? 'Not installed' : 'Not configured'}
            </span>
          </div>
        )}
        {secondaryStatus && (
          <div className="tool-status-item">
            <StatusDot ready={secondaryReady ?? false} />
            <strong>{secondaryStatus.toolName}</strong>
            <span className="muted">
              {secondaryStatus.status === 'ready' ? secondaryStatus.versionText ?? 'Ready' : secondaryStatus.status === 'missing' ? 'Not installed' : 'Not configured'}
            </span>
          </div>
        )}
      </div>

      {downloadState.isDownloading ? (
        <DownloadProgressBar progress={downloadState.progress} />
      ) : (
        <div className="tool-card-actions">
          <button className="button primary compact" onClick={onDownload} disabled={downloadState.isDownloading}>
            {allReady ? 'Update' : 'Download'} {title}
          </button>
          {downloadState.progress?.phase === 'complete' && (
            <span className="tool-success-msg">{downloadState.progress.message}</span>
          )}
          {downloadState.progress?.phase === 'error' && (
            <span className="tool-error-msg">{downloadState.progress.message}</span>
          )}
        </div>
      )}

      <div className="tool-card-config">
        <label className="field" style={{ maxWidth: 200 }}>
          <span>Resolution mode</span>
          <select value={modeValue} onChange={(e) => onModeChange(e.target.value)}>
            <option value="bundled">Bundled (managed)</option>
            <option value="auto-detect">Auto-detect (PATH)</option>
            <option value="custom">Custom path</option>
          </select>
        </label>
      </div>

      {showCustomPaths && (
        <div className="stack gap-sm">
          {customPaths.map((cp) => (
            <div className="field-group" key={cp.label}>
              <label className="field">
                <span>{cp.label}</span>
                <input value={cp.value} readOnly />
              </label>
              <button className="button secondary" onClick={cp.onBrowse}>Browse</button>
            </div>
          ))}
        </div>
      )}

      {status?.resolvedPath && (
        <div className="tool-resolved-path">
          <span className="muted" style={{ fontSize: '0.82rem' }}>{status.resolvedPath}</span>
        </div>
      )}
    </div>
  );
};

const DirectoryRow = ({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: () => void;
}): JSX.Element => (
  <div className="field-group">
    <label className="field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
    <button className="button secondary" onClick={onPick}>Browse</button>
  </div>
);

export const SettingsScreen = ({ controller }: { controller: SettingsController }): JSX.Element => {
  const { draft, binaryStatus, diagnostics, error, isSaving } = controller;

  if (!draft) {
    return <div className="panel">Loading settings...</div>;
  }

  return (
    <div className="content-grid">
      <section className="panel stack gap-lg">
        <div className="stack gap-sm">
          <p className="eyebrow">Settings</p>
          <h1>Desktop defaults</h1>
          <p className="muted">
            Settings persist through SQLite in Phase 1 while the controller layer keeps file pickers and tool discovery out of the UI components.
          </p>
        </div>

        {error ? <div className="notice danger">{error}</div> : null}

        <div className="stack gap-md">
          <h2>Folders</h2>
          <DirectoryRow label="Download directory" value={draft.downloadDirectory} onPick={() => void controller.pickDirectory('downloadDirectory', 'Choose default download directory')} />
          <DirectoryRow label="Export directory" value={draft.exportDirectory} onPick={() => void controller.pickDirectory('exportDirectory', 'Choose default export directory')} />
          <DirectoryRow label="Temp directory" value={draft.tempDirectory} onPick={() => void controller.pickDirectory('tempDirectory', 'Choose temporary job directory')} />
        </div>

        <div className="grid-two">
          <label className="field">
            <span>Max concurrent downloads</span>
            <input type="number" value={draft.maxConcurrentDownloads} min={1} max={8} onChange={(event) => controller.updateField('maxConcurrentDownloads', Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Max concurrent processing jobs</span>
            <input type="number" value={draft.maxConcurrentProcessingJobs} min={1} max={8} onChange={(event) => controller.updateField('maxConcurrentProcessingJobs', Number(event.target.value))} />
          </label>
        </div>

        <div className="grid-two">
          <label className="field">
            <span>Default output format</span>
            <select value={draft.defaultOutputFormat} onChange={(event) => controller.updateField('defaultOutputFormat', event.target.value as AppSettings['defaultOutputFormat'])}>
              <option value="original">Original</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="webm">WebM</option>
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
            </select>
          </label>
          <label className="field">
            <span>Default audio format</span>
            <select value={draft.defaultAudioFormat} onChange={(event) => controller.updateField('defaultAudioFormat', event.target.value as AppSettings['defaultAudioFormat'])}>
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
            </select>
          </label>
        </div>

        <div className="grid-two">
          <label className="field">
            <span>Preferred browser</span>
            <select value={draft.preferredBrowser} onChange={(event) => controller.updateField('preferredBrowser', event.target.value as AppSettings['preferredBrowser'])}>
              <option value="edge">Microsoft Edge</option>
              <option value="chrome">Google Chrome</option>
              <option value="firefox">Mozilla Firefox</option>
            </select>
          </label>
          <label className="field">
            <span>Overwrite behavior</span>
            <select value={draft.overwriteBehavior} onChange={(event) => controller.updateField('overwriteBehavior', event.target.value as AppSettings['overwriteBehavior'])}>
              <option value="save-as-new">Save as new file</option>
              <option value="replace-existing">Replace existing target</option>
              <option value="confirm-replace-original">Confirm before replacing original</option>
            </select>
          </label>
        </div>

        <div className="notice warning">
          Replacing an existing file can overwrite source media. Keep backups enabled if you want a safer default before replace workflows go live.
        </div>

        <label className="field">
          <span>Clip naming pattern</span>
          <input value={draft.clipNamingPattern} onChange={(event) => controller.updateField('clipNamingPattern', event.target.value)} />
        </label>

        <div className="toggle-row">
          <label><input type="checkbox" checked={draft.backupBeforeReplace} onChange={(event) => controller.updateField('backupBeforeReplace', event.target.checked)} /> Backup originals before replace</label>
        </div>

        <div className="button-row">
          <button className="button secondary" onClick={() => void controller.reset()}>Reset defaults</button>
          <button className="button primary" onClick={() => void controller.save()}>{isSaving ? 'Saving...' : 'Save settings'}</button>
        </div>
      </section>

      <section className="panel stack gap-lg">
        <h2>Tool configuration</h2>

        <ToolCard
          title="yt-dlp"
          description="Video metadata extraction and downloading"
          status={binaryStatus.find((s) => s.toolName === 'yt-dlp') ?? null}
          downloadState={controller.downloadStates['yt-dlp']}
          onDownload={() => void controller.downloadTool('yt-dlp')}
          modeValue={draft.ytDlpMode}
          onModeChange={(value) => controller.updateField('ytDlpMode', value as AppSettings['ytDlpMode'])}
          customPaths={[
            { label: 'yt-dlp executable', value: draft.ytDlpPath, onBrowse: () => void controller.chooseBinaryPath('yt-dlp') },
          ]}
        />

        <ToolCard
          title="ffmpeg & ffprobe"
          description="Media muxing, encoding, and stream inspection"
          status={binaryStatus.find((s) => s.toolName === 'ffmpeg') ?? null}
          secondaryStatus={binaryStatus.find((s) => s.toolName === 'ffprobe') ?? null}
          downloadState={controller.downloadStates['ffmpeg-bundle']}
          onDownload={() => void controller.downloadTool('ffmpeg-bundle')}
          modeValue={draft.ffmpegMode}
          onModeChange={(value) => controller.updateField('ffmpegMode', value as AppSettings['ffmpegMode'])}
          customPaths={[
            { label: 'ffmpeg executable', value: draft.ffmpegPath, onBrowse: () => void controller.chooseBinaryPath('ffmpeg') },
            { label: 'ffprobe executable', value: draft.ffprobePath, onBrowse: () => void controller.chooseBinaryPath('ffprobe') },
          ]}
        />

        <div className="stack gap-sm">
          <h3>Diagnostics</h3>
          {diagnostics ? (
            <>
              <div className="list-card"><strong>Version</strong><span>{diagnostics.appVersion}</span></div>
              <div className="list-card"><strong>User data</strong><span>{diagnostics.userDataPath}</span></div>
              <div className="list-card"><strong>Database</strong><span>{diagnostics.databasePath}</span></div>
              <div className="list-card"><strong>Logs</strong><span>{diagnostics.logsPath}</span></div>
              <div className="list-card"><strong>Binaries</strong><span>{diagnostics.binariesPath}</span></div>
            </>
          ) : (
            <div className="empty-state">Diagnostics are loading.</div>
          )}
        </div>
      </section>
    </div>
  );
};
