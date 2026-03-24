import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

import { protocol } from 'electron';

const SCHEME = 'yoinkr-media';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Parse first Range header value. Returns inclusive byte range or null (send full file).
 */
function parseByteRange(rangeHeader: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }
  const spec = rangeHeader.slice(6).split(',')[0]?.trim();
  if (!spec) {
    return null;
  }

  if (spec.startsWith('-')) {
    const suffixLen = Number.parseInt(spec.slice(1), 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      return null;
    }
    const start = Math.max(0, size - suffixLen);
    return { start, end: size - 1 };
  }

  const dash = spec.indexOf('-');
  if (dash < 0) {
    return null;
  }
  const startStr = spec.slice(0, dash);
  const endStr = spec.slice(dash + 1);
  const start = startStr === '' ? 0 : Number.parseInt(startStr, 10);
  let end = endStr === '' ? size - 1 : Number.parseInt(endStr, 10);

  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return 'unsatisfiable';
  }
  if (!Number.isFinite(end)) {
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (end < start) {
    return 'unsatisfiable';
  }
  return { start, end };
}

/**
 * Call once before app is ready so we can use `standard: true` + stream responses.
 */
export const registerYoinkrMediaSchemePrivileged = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
};

const decodePathFromUrl = (rawUrl: string): string | null => {
  try {
    const u = new URL(rawUrl);
    const q = u.searchParams.get('path');
    if (!q) {
      return null;
    }
    return decodeURIComponent(q);
  } catch {
    return null;
  }
};

/**
 * Serve local media with correct **byte Range** support.
 * Chromium's &lt;video&gt; requires 206 + Content-Range for seeking and steady timeupdate;
 * plain net.fetch(file://) through protocol.handle does not satisfy that.
 *
 * yoinkr-media://preview/?path=&lt;encodeURIComponent(absolutePath)&gt;
 */
export const registerYoinkrMediaProtocol = (): void => {
  protocol.handle(SCHEME, async (request) => {
    const filePath = decodePathFromUrl(request.url);
    if (!filePath) {
      return new Response('Missing path', { status: 400 });
    }

    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const mime = mimeForPath(filePath);
    const rangeHeader = request.headers.get('range');
    const parsed = parseByteRange(rangeHeader, size);

    if (parsed === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const isHead = request.method === 'HEAD';

    if (parsed === null) {
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      };
      if (isHead) {
        return new Response(null, { status: 200, headers });
      }
      const nodeStream = createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream);
      return new Response(webStream, { status: 200, headers });
    }

    const { start, end } = parsed;
    const chunkLength = end - start + 1;
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(chunkLength),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    };
    if (isHead) {
      return new Response(null, { status: 206, headers });
    }

    const nodeStream = createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(nodeStream);
    return new Response(webStream, { status: 206, headers });
  });
};
