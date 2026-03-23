import type { ProcessRunner } from '@main/services/shared/process-runner';
import { ServiceError } from '@main/services/shared/service-error';
import type { BinaryResolver } from '@main/services/tools/binary-resolver';
import type { EditorMediaChapter, EditorMediaInfo, EditorMediaStreamInfo } from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';

interface FfprobeJson {
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    start_time?: string;
    bit_rate?: string;
    probe_score?: number;
    tags?: Record<string, string | undefined>;
  };
  streams?: Array<{
    index?: number;
    codec_type?: string;
    codec_name?: string;
    codec_long_name?: string;
    profile?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    sample_rate?: string;
    channels?: number;
    channel_layout?: string;
    avg_frame_rate?: string;
    bit_rate?: string;
    duration?: string;
    disposition?: {
      default?: number;
    };
  }>;
  chapters?: Array<{
    id?: number;
    start_time?: string;
    end_time?: string;
    tags?: Record<string, string | undefined>;
  }>;
}

const supportedMergeExtensions = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.m4a', '.mp3', '.wav']);
const knownContainerExtensions = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'm4a', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'opus']);

const parseNumber = (value: string | number | undefined | null): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class FfprobeAnalysisService {
  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  async inspectSource(sourcePath: string, settings: AppSettings): Promise<EditorMediaInfo> {
    const resolved = this.binaryResolver.resolveTool('ffprobe', settings);
    if (!resolved.resolvedPath || !resolved.exists) {
      throw new ServiceError('FFPROBE_NOT_FOUND', 'ffprobe was not found. Configure it in Settings before opening media in the editor.');
    }

    const result = await this.processRunner.run({
      command: resolved.resolvedPath,
      args: [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-show_chapters',
        sourcePath,
      ],
      timeoutMs: 45000,
      maxBufferBytes: 24 * 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      throw new ServiceError(
        'FFPROBE_FAILED',
        'ffprobe could not inspect the selected media file.',
        result.stderr || result.stdout || undefined,
      );
    }

    let parsed: FfprobeJson;
    try {
      parsed = JSON.parse(result.stdout) as FfprobeJson;
    } catch {
      throw new ServiceError('FFPROBE_PARSE_FAILED', 'ffprobe returned unreadable metadata.');
    }

    const streams = (parsed.streams ?? []).map<EditorMediaStreamInfo>((stream) => ({
      index: stream.index ?? 0,
      codecType: stream.codec_type ?? 'unknown',
      codecName: stream.codec_name ?? null,
      codecLongName: stream.codec_long_name ?? null,
      profile: stream.profile ?? null,
      width: stream.width ?? null,
      height: stream.height ?? null,
      pixelFormat: stream.pix_fmt ?? null,
      sampleRate: parseNumber(stream.sample_rate),
      channels: stream.channels ?? null,
      channelLayout: stream.channel_layout ?? null,
      avgFrameRate: stream.avg_frame_rate ?? null,
      bitRate: parseNumber(stream.bit_rate),
      durationSeconds: parseNumber(stream.duration),
      isDefault: stream.disposition?.default === 1,
    }));

    const primaryVideoStream =
      streams.find((stream) => stream.codecType === 'video' && stream.isDefault)
      ?? streams.find((stream) => stream.codecType === 'video')
      ?? null;
    const primaryAudioStream =
      streams.find((stream) => stream.codecType === 'audio' && stream.isDefault)
      ?? streams.find((stream) => stream.codecType === 'audio')
      ?? null;
    const videoStreams = streams.filter((stream) => stream.codecType === 'video');
    const primaryVideoSelectorIndex = primaryVideoStream
      ? Math.max(0, videoStreams.findIndex((stream) => stream.index === primaryVideoStream.index))
      : null;

    const hasVideo = Boolean(primaryVideoStream);
    const hasAudio = Boolean(primaryAudioStream);
    const formatName = parsed.format?.format_name ?? null;
    const container = this.resolveContainerLabel(sourcePath, formatName);
    const durationSeconds =
      parseNumber(parsed.format?.duration)
      ?? primaryVideoStream?.durationSeconds
      ?? primaryAudioStream?.durationSeconds
      ?? null;

    const warnings: string[] = [];
    if (!hasVideo && !hasAudio) {
      warnings.push('The selected file does not expose a playable audio or video stream.');
    }
    if (durationSeconds === null) {
      warnings.push('The source duration could not be detected, so segment validation will be more limited.');
    }
    if (streams.filter((stream) => stream.codecType === 'video').length > 1) {
      warnings.push('Multiple video streams were detected. Phase 3 uses the default video stream only.');
    }
    if (streams.filter((stream) => stream.codecType === 'audio').length > 1) {
      warnings.push('Multiple audio streams were detected. Phase 3 keeps the existing stream layout during export.');
    }

    const keyframeResult = hasVideo && primaryVideoSelectorIndex !== null
      ? await this.inspectKeyframes(sourcePath, resolved.resolvedPath, primaryVideoSelectorIndex)
      : { keyframeTimes: [], status: hasVideo ? 'unavailable' as const : 'not-applicable' as const, message: hasVideo ? 'No primary video stream was selected for keyframe analysis.' : null };
    if (hasVideo && keyframeResult.status !== 'available') {
      warnings.push(keyframeResult.message ?? 'Keyframe-safe cut boundaries could not be determined for this file.');
    }

    const chapters = (parsed.chapters ?? []).map<EditorMediaChapter>((chapter, index) => ({
      id: String(chapter.id ?? index),
      title: chapter.tags?.title ?? null,
      startSeconds: parseNumber(chapter.start_time) ?? 0,
      endSeconds: parseNumber(chapter.end_time) ?? 0,
    }));

    const streamCopySupported = hasVideo || hasAudio;
    const mergeCutsSupported = streamCopySupported && supportedMergeExtensions.has(this.extensionFromPath(sourcePath));
    if (!mergeCutsSupported) {
      warnings.push('Merge export is limited to common stream-copy-friendly containers in this phase.');
    }

    return {
      formatName,
      formatLongName: parsed.format?.format_long_name ?? null,
      container,
      durationSeconds,
      startTimeSeconds: parseNumber(parsed.format?.start_time),
      bitRate: parseNumber(parsed.format?.bit_rate),
      probeScore: parseNumber(parsed.format?.probe_score),
      hasVideo,
      hasAudio,
      primaryVideoStream,
      primaryAudioStream,
      streams,
      chapters,
      keyframeTimes: keyframeResult.keyframeTimes,
      keyframeAnalysisStatus: keyframeResult.status,
      keyframeAnalysisMessage: keyframeResult.message,
      streamCopySupported,
      mergeCutsSupported,
      warnings,
    };
  }

  private extensionFromPath(sourcePath: string): string {
    const index = sourcePath.lastIndexOf('.');
    return index >= 0 ? sourcePath.slice(index).toLowerCase() : '';
  }

  private resolveContainerLabel(sourcePath: string, formatName: string | null): string | null {
    const extension = this.extensionFromPath(sourcePath).replace(/^\./, '').toLowerCase();
    if (extension && knownContainerExtensions.has(extension)) {
      return extension;
    }

    return formatName?.split(',')[0]?.trim() ?? null;
  }

  private async inspectKeyframes(
    sourcePath: string,
    ffprobePath: string,
    streamIndex: number,
  ): Promise<{ keyframeTimes: number[]; status: 'available' | 'unavailable'; message: string | null }> {
    try {
      const result = await this.processRunner.run({
        command: ffprobePath,
        args: [
          '-v',
          'error',
          '-select_streams',
          `v:${streamIndex}`,
          '-show_packets',
          '-show_entries',
          'packet=pts_time,flags',
          '-of',
          'csv=p=0',
          sourcePath,
        ],
        timeoutMs: 45000,
        maxBufferBytes: 24 * 1024 * 1024,
      });

      if (result.exitCode !== 0) {
        return {
          keyframeTimes: [],
          status: 'unavailable',
          message: result.stderr || 'ffprobe failed while reading video packet keyframes.',
        };
      }

      const keyframeTimes = result.stdout
        .split(/\r?\n/)
        .map((line) => line.split(','))
        .filter((parts) => (parts[parts.length - 1] ?? '').includes('K'))
        .map((parts) => Number.parseFloat(parts[0]?.trim() ?? ''))
        .filter((value, index, all) => Number.isFinite(value) && (index === 0 || value !== all[index - 1]));

      return keyframeTimes.length > 0
        ? { keyframeTimes, status: 'available', message: null }
        : {
          keyframeTimes: [],
          status: 'unavailable',
          message: 'ffprobe did not return usable keyframe packets for the primary video stream.',
        };
    } catch (error) {
      return {
        keyframeTimes: [],
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'Keyframe analysis failed.',
      };
    }
  }
}
