import type { EditorCutBoundaryInfo, EditorCutMode, EditorExportPreview, EditorExportRequest, EditorExportStrategy, EditorPreviewSegment, EditorSegment } from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';

import type { FfprobeAnalysisService } from './ffprobe-analysis-service';

const almostEqual = (left: number, right: number): boolean => Math.abs(left - right) <= 0.001;

export class ExportPlanningService {
  constructor(private readonly ffprobeAnalysisService: FfprobeAnalysisService) {}

  async previewExport(request: EditorExportRequest, settings: AppSettings): Promise<EditorExportPreview> {
    const mediaInfo = await this.ffprobeAnalysisService.inspectSource(request.sourcePath, settings);
    const segmentPreviews = request.segments
      .filter((segment) => segment.selected)
      .map((segment) => this.buildSegmentPreview(segment, request.cutMode, mediaInfo));

    const strategies = new Set(segmentPreviews.map((segment) => segment.strategy));
    const strategy: EditorExportStrategy = strategies.has('re-encode')
      ? 're-encode'
      : strategies.has('smart-cut')
        ? 'smart-cut'
        : 'stream-copy';

    const warnings = [...mediaInfo.warnings];
    if (request.exportMode === 'merge-cuts' || request.exportMode === 'merge-and-separate') {
      if (strategy === 'stream-copy' && !mediaInfo.mergeCutsSupported) {
        warnings.push('Merged stream-copy export is not safe for this source container. Choose exact mode or export separate files.');
      }
      if (strategy !== 'stream-copy') {
        warnings.push('Merged exact output will re-encode the selected cuts before combining them.');
      }
    }

    if (request.cutMode === 'exact' && strategy === 're-encode') {
      warnings.push('Exact timestamp mode requires re-encoding for at least one selected segment.');
    }
    if (request.cutMode === 'auto' && strategy === 're-encode') {
      warnings.push('Auto mode selected re-encode so the requested output can stay exact.');
    }

    const canExport =
      segmentPreviews.length > 0
      && (
        strategy !== 'stream-copy'
        || request.exportMode === 'single-cut'
        || request.exportMode === 'separate-files'
        || mediaInfo.mergeCutsSupported
      );

    return {
      exportMode: request.exportMode,
      cutMode: request.cutMode,
      strategy,
      canExport,
      mergeSupported: strategy !== 'stream-copy' || mediaInfo.mergeCutsSupported,
      outputDescription: this.describeOutput(request, segmentPreviews.length, strategy),
      outputPathHint: request.exportMode === 'single-cut' || request.exportMode === 'merge-cuts'
        ? request.outputFilePath?.trim() || null
        : request.outputDirectory?.trim() || null,
      warnings,
      segments: segmentPreviews,
    };
  }

  private buildSegmentPreview(
    segment: EditorSegment,
    cutMode: EditorCutMode,
    mediaInfo: Awaited<ReturnType<FfprobeAnalysisService['inspectSource']>>,
  ): EditorPreviewSegment {
    const boundary = this.buildBoundaryInfo(segment, cutMode, mediaInfo);
    const warnings: string[] = [];

    let strategy: EditorExportStrategy = 'stream-copy';
    if (cutMode === 'stream-copy') {
      strategy = 'stream-copy';
      if (!boundary.keyframeSafe && mediaInfo.hasVideo) {
        warnings.push('Stream-copy mode will adjust this segment to nearby safe keyframe boundaries.');
      }
    } else if (cutMode === 'exact') {
      strategy = boundary.keyframeSafe || !mediaInfo.hasVideo ? 'stream-copy' : 're-encode';
      if (strategy === 're-encode') {
        warnings.push('Exact mode requires re-encoding because the requested timestamps are not keyframe-safe.');
      }
    } else {
      strategy = boundary.keyframeSafe || !mediaInfo.hasVideo ? 'stream-copy' : 're-encode';
      if (strategy === 're-encode') {
        warnings.push('Auto mode chose re-encode so this segment can stay exact.');
      }
    }

    if (
      strategy === 'stream-copy'
      && mediaInfo.hasVideo
      && mediaInfo.keyframeAnalysisStatus !== 'available'
      && !boundary.keyframeSafe
    ) {
      warnings.push('Keyframe-safe boundaries could not be verified for this video; stream-copy output may not match the exact requested timestamps.');
    }

    return {
      segmentId: segment.id,
      label: segment.label,
      boundary,
      strategy,
      warnings,
    };
  }

  private buildBoundaryInfo(
    segment: EditorSegment,
    cutMode: EditorCutMode,
    mediaInfo: Awaited<ReturnType<FfprobeAnalysisService['inspectSource']>>,
  ): EditorCutBoundaryInfo {
    const requestedStartSeconds = segment.requestedStartSeconds;
    const requestedEndSeconds = segment.requestedEndSeconds;
    const previousKeyframeSeconds = this.findPreviousKeyframe(mediaInfo.keyframeTimes, requestedStartSeconds);
    const nextKeyframeSeconds = this.findNextKeyframe(mediaInfo.keyframeTimes, requestedEndSeconds);

    const keyframeSafe = !mediaInfo.hasVideo || (
      previousKeyframeSeconds !== null
      && nextKeyframeSeconds !== null
      && almostEqual(previousKeyframeSeconds, requestedStartSeconds)
      && almostEqual(nextKeyframeSeconds, requestedEndSeconds)
    );

    if (!mediaInfo.hasVideo || mediaInfo.keyframeAnalysisStatus !== 'available') {
      return {
        requestedStartSeconds,
        requestedEndSeconds,
        actualStartSeconds: requestedStartSeconds,
        actualEndSeconds: requestedEndSeconds,
        previousKeyframeSeconds,
        nextKeyframeSeconds,
        keyframeSafe,
        exactRequested: cutMode === 'exact',
        adjustmentReason: mediaInfo.hasVideo && mediaInfo.keyframeAnalysisStatus === 'unavailable'
          ? 'Keyframe boundaries were unavailable during analysis.'
          : null,
      };
    }

    if (cutMode === 'exact' || keyframeSafe) {
      return {
        requestedStartSeconds,
        requestedEndSeconds,
        actualStartSeconds: requestedStartSeconds,
        actualEndSeconds: requestedEndSeconds,
        previousKeyframeSeconds,
        nextKeyframeSeconds,
        keyframeSafe,
        exactRequested: cutMode === 'exact',
        adjustmentReason: null,
      };
    }

    const actualStartSeconds = previousKeyframeSeconds ?? requestedStartSeconds;
    const actualEndSeconds = Math.max(nextKeyframeSeconds ?? requestedEndSeconds, actualStartSeconds);
    return {
      requestedStartSeconds,
      requestedEndSeconds,
      actualStartSeconds,
      actualEndSeconds,
      previousKeyframeSeconds,
      nextKeyframeSeconds,
      keyframeSafe,
      exactRequested: false,
      adjustmentReason: 'Adjusted to the nearest safe keyframe boundaries for lossless stream copy.',
    };
  }

  private findPreviousKeyframe(keyframes: number[], targetSeconds: number): number | null {
    if (keyframes.length === 0) {
      return null;
    }

    let candidate = keyframes[0] ?? null;
    for (const keyframe of keyframes) {
      if (keyframe > targetSeconds) {
        break;
      }
      candidate = keyframe;
    }
    return candidate;
  }

  private findNextKeyframe(keyframes: number[], targetSeconds: number): number | null {
    for (const keyframe of keyframes) {
      if (keyframe >= targetSeconds) {
        return keyframe;
      }
    }
    return keyframes[keyframes.length - 1] ?? null;
  }

  private describeOutput(
    request: EditorExportRequest,
    selectedSegmentsCount: number,
    strategy: EditorExportStrategy,
  ): string {
    if (request.exportMode === 'single-cut') {
      return `${strategy === 'stream-copy' ? 'Lossless' : 'Exact'} single-cut export`;
    }
    if (request.exportMode === 'merge-cuts') {
      return `${strategy === 'stream-copy' ? 'Merged lossless' : 'Merged exact'} export for ${selectedSegmentsCount} segment${selectedSegmentsCount === 1 ? '' : 's'}`;
    }
    if (request.exportMode === 'merge-and-separate') {
      return `Separate exports plus merged output for ${selectedSegmentsCount} segment${selectedSegmentsCount === 1 ? '' : 's'}`;
    }

    return `Separate exports for ${selectedSegmentsCount} segment${selectedSegmentsCount === 1 ? '' : 's'}`;
  }
}
