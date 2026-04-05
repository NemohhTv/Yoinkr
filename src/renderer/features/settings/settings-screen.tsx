import { useState } from 'react';

import type { BinaryStatus, DownloadableToolName } from '@shared/types/common';
import type { AppSettings, YtDlpCookieMode } from '@shared/types/settings';
import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';
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
    field: 'downloadDirectory' | 'audioDownloadDirectory' | 'exportDirectory' | 'tempDirectory',
    title: string,
  ) => Promise<void>;
  pickCookiesFile: () => Promise<void>;
  testYtDlpCookies: () => Promise<void>;
  cookieTestResult: { ok: boolean; message: string } | null;
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
  showManagedDownload = true,
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
  /** When false, hide bundled download/update (e.g. Deno is installed separately). */
  showManagedDownload?: boolean;
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

      {showManagedDownload &&
        (downloadState.isDownloading ? (
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
        ))}

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
  const [revealCookiesPath, setRevealCookiesPath] = useState(false);

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
            Configure video/audio download folders, export and temp paths, bundled tools, cookies, and download behavior. Use <strong>Save settings</strong> at the bottom of this page to persist changes.
          </p>
        </div>

        {error ? <div className="notice danger">{error}</div> : null}

        <div className="stack gap-md">
          <h2>Folders</h2>
          <DirectoryRow label="Download directory (video)" value={draft.downloadDirectory} onPick={() => void controller.pickDirectory('downloadDirectory', 'Choose folder for video downloads')} />
          <DirectoryRow label="Audio download directory" value={draft.audioDownloadDirectory} onPick={() => void controller.pickDirectory('audioDownloadDirectory', 'Choose folder for audio-only downloads')} />
          <p className="muted" style={{ fontSize: '0.82rem', margin: '-8px 0 0' }}>
            Audio folder is used for audio-only queue items and when saving as mp3, m4a, wav, or flac. Leave blank to use the video download folder. Use <strong>Save settings</strong> so the downloader sees your paths.
          </p>
          <DirectoryRow label="Export directory" value={draft.exportDirectory} onPick={() => void controller.pickDirectory('exportDirectory', 'Choose default export directory')} />
          <DirectoryRow label="Temp directory" value={draft.tempDirectory} onPick={() => void controller.pickDirectory('tempDirectory', 'Choose temporary job directory')} />
        </div>

        <h3 className="settings-subsection-title">Queue &amp; pacing</h3>
        <div className="grid-two">
          <label className="field">
            <span>Max concurrent downloads</span>
            <input type="number" value={draft.maxConcurrentDownloads} min={1} max={8} onChange={(event) => controller.updateField('maxConcurrentDownloads', Number(event.target.value))} />
            <span className="muted" style={{ fontSize: '0.82rem', display: 'block', marginTop: 4 }}>
              For <strong>Download all</strong> only. Per-row downloads ignore this. Throttle mode (below) always does one at a time.
            </span>
          </label>
          <label className="field">
            <span>Max concurrent processing jobs</span>
            <input type="number" value={draft.maxConcurrentProcessingJobs} min={1} max={8} onChange={(event) => controller.updateField('maxConcurrentProcessingJobs', Number(event.target.value))} />
          </label>
        </div>

        <label className="field">
          <span>Section clip: parallel fragments (1–32)</span>
          <input
            type="number"
            value={draft.sectionConcurrentFragments}
            min={1}
            max={32}
            onChange={(event) => controller.updateField('sectionConcurrentFragments', Number(event.target.value))}
          />
          <span className="muted" style={{ fontSize: '0.82rem', display: 'block', marginTop: 4 }}>
            Timed section downloads only. Lower if merge stalls; higher on fast disks.
          </span>
        </label>

        <div className="settings-option-stack">
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={draft.downloadThrottleMode}
              onChange={(event) => controller.updateField('downloadThrottleMode', event.target.checked)}
            />
            <span className="settings-checkbox-title">Download throttle mode</span>
          </label>
          <p className="settings-option-help">
            Gentler requests to the site: about 2–6 seconds between downloads, at most 3 parallel fragments, and <strong>Download all</strong> runs one queue item at a time. This may help with busy sites; it is not a guarantee against limits or account issues.
          </p>
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

        <div className="stack gap-sm">
          <h3 style={{ margin: 0, fontSize: '1rem' }}>YouTube &amp; restricted sites (cookies)</h3>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Age-restricted and members-only videos need a logged-in session. Yoinkr passes cookies directly to yt-dlp.
            <strong> Browser mode</strong> reads the cookie database from disk — fully quit the browser first.
            On <strong>Windows</strong>, Browser mode is only offered for <strong>Firefox</strong>. Chrome and Edge are blocked (encrypted cookies / wrong profile paths like <code>default-release</code> under Edge). Use <strong>Cookies.txt file</strong> for Chrome or Edge.
            <strong> Cookies file</strong> is the most reliable method — use a browser extension like &quot;Get cookies.txt LOCALLY&quot; to export, then point Yoinkr to that file.
          </p>
          <label className="field">
            <span>Cookie source</span>
            <select
              value={draft.ytDlpCookieMode}
              onChange={(event) => controller.updateField('ytDlpCookieMode', event.target.value as YtDlpCookieMode)}
            >
              <option value="none">Off (public videos only)</option>
              <option value="browser">Browser (Firefox only on Windows)</option>
              <option value="file">Cookies.txt file (recommended)</option>
              <option value="paste">Paste cookies.txt text</option>
            </select>
          </label>
          {draft.ytDlpCookieMode === 'browser' && (
            <>
              <label className="field">
                <span>Browser to read cookies from</span>
                <select value={draft.preferredBrowser} onChange={(event) => controller.updateField('preferredBrowser', event.target.value as AppSettings['preferredBrowser'])}>
                  <option value="firefox">Mozilla Firefox</option>
                </select>
              </label>
              <label className="field">
                <span>Browser profile (optional)</span>
                <input
                  value={draft.ytDlpBrowserProfile}
                  onChange={(e) => controller.updateField('ytDlpBrowserProfile', e.target.value)}
                  placeholder="e.g. xxxxx.default-release (see about:profiles in Firefox)"
                  spellCheck={false}
                />
              </label>
              <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                Leave blank to let yt-dlp choose. Firefox: go to <code>about:profiles</code> and use the root folder name.
                On Windows only Firefox browser mode works; for Chrome/Edge use the <strong>Cookies file</strong> option instead.
              </p>
            </>
          )}
          {draft.ytDlpCookieMode === 'file' && (
            <div className="field-group">
              <label className="field">
                <span>cookies.txt path</span>
                <input
                  className="settings-cookies-path-input"
                  type={draft.ytDlpCookiesFilePath && !revealCookiesPath ? 'password' : 'text'}
                  value={draft.ytDlpCookiesFilePath}
                  readOnly
                  placeholder="Browse to your exported cookies.txt"
                  autoComplete="off"
                  spellCheck={false}
                  title={draft.ytDlpCookiesFilePath ? 'Click to show or hide the full path' : undefined}
                  onFocus={() => {
                    setRevealCookiesPath(true);
                  }}
                  onBlur={() => {
                    setRevealCookiesPath(false);
                  }}
                />
              </label>
              <button type="button" className="button secondary" onClick={() => void controller.pickCookiesFile()}>Browse…</button>
            </div>
          )}
          {draft.ytDlpCookieMode === 'paste' && (
            <label className="field">
              <span>Netscape cookies.txt content (paste full file)</span>
              <textarea
                className="settings-cookie-paste"
                rows={10}
                spellCheck={false}
                autoComplete="off"
                placeholder={'# Netscape HTTP Cookie File\n# (paste entire export from Get cookies.txt or similar)'}
                value={draft.ytDlpCookiesPastedText}
                onChange={(e) => controller.updateField('ytDlpCookiesPastedText', e.target.value)}
              />
            </label>
          )}
          <div className="button-row" style={{ marginTop: 4 }}>
            <button type="button" className="button secondary" onClick={() => void controller.testYtDlpCookies()}>
              Validate cookie source
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            Saves auth settings immediately and checks that the cookie source exists. The file is passed directly to yt-dlp without any modification.
          </p>
          {controller.cookieTestResult && (
            <div className={controller.cookieTestResult.ok ? 'notice info' : 'notice danger'} style={{ fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>
              {controller.cookieTestResult.message}
            </div>
          )}
        </div>

        <label className="field">
          <span>Overwrite behavior</span>
          <select value={draft.overwriteBehavior} onChange={(event) => controller.updateField('overwriteBehavior', event.target.value as AppSettings['overwriteBehavior'])}>
            <option value="save-as-new">Save as new file</option>
            <option value="replace-existing">Replace existing target</option>
            <option value="confirm-replace-original">Confirm before replacing original</option>
          </select>
        </label>

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

        <div className="stack gap-sm">
          <div className="toggle-row">
            <label>
              <input
                type="checkbox"
                checked={draft.saveDownloadLogs}
                onChange={(event) => controller.updateField('saveDownloadLogs', event.target.checked)}
              />{' '}
              Save yt-dlp stderr to log files (helps debug slow or stuck downloads)
            </label>
          </div>
          <div className="button-row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="button secondary compact"
              onClick={() => void yoinkrClient.app.openDownloadLogsDirectory()}
            >
              Open download logs folder
            </button>
            <span className="muted" style={{ fontSize: '0.82rem', flex: '1 1 200px' }}>
              One .log file per download attempt under your Yoinkr data → logs → downloads.
            </span>
          </div>
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

        <div className="stack gap-sm">
          <ToolCard
            title="Deno"
            description="JavaScript runtime for YouTube extraction in yt-dlp. Use Download to fetch the latest Deno from GitHub, install manually from deno.com, or set a custom path."
            status={binaryStatus.find((s) => s.toolName === 'deno') ?? null}
            downloadState={controller.downloadStates.deno}
            onDownload={() => void controller.downloadTool('deno')}
            modeValue={draft.denoMode}
            onModeChange={(value) => controller.updateField('denoMode', value as AppSettings['denoMode'])}
            customPaths={[
              { label: 'deno executable', value: draft.denoPath, onBrowse: () => void controller.chooseBinaryPath('deno') },
            ]}
          />
          <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
            Background:{' '}
            <a href="https://github.com/yt-dlp/yt-dlp/issues/14404" target="_blank" rel="noreferrer">
              yt-dlp — upcoming requirements for YouTube downloads
            </a>
            . Yoinkr passes <code>--js-runtimes deno</code> to yt-dlp when Deno is detected, otherwise <code>node</code>.
          </p>
        </div>

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
