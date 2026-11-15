export type ParsedRangeResult =
  | { type: 'full' }
  | { type: 'partial'; start: number; end: number; totalBytes: number }
  | { type: 'unsatisfiable'; totalBytes: number };

export function parseHttpByteRange(
  rangeHeader: string | null | undefined,
  totalBytes: number,
): ParsedRangeResult {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return rangeHeader ? { type: 'unsatisfiable', totalBytes: 0 } : { type: 'full' };
  }

  if (!rangeHeader || !rangeHeader.trim()) {
    return { type: 'full' };
  }

  const trimmed = rangeHeader.trim();
  const match = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i.exec(trimmed);
  if (!match) {
    return { type: 'unsatisfiable', totalBytes };
  }

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';

  if (rawStart === '' && rawEnd === '') {
    return { type: 'unsatisfiable', totalBytes };
  }

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLen = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLen) || suffixLen <= 0) {
      return { type: 'unsatisfiable', totalBytes };
    }
    start = Math.max(0, totalBytes - suffixLen);
    end = totalBytes - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= totalBytes) {
      return { type: 'unsatisfiable', totalBytes };
    }
    if (rawEnd === '') {
      end = totalBytes - 1;
    } else {
      end = Number(rawEnd);
      if (!Number.isSafeInteger(end) || end < start) {
        return { type: 'unsatisfiable', totalBytes };
      }
      end = Math.min(end, totalBytes - 1);
    }
  }

  return { type: 'partial', start, end, totalBytes };
}

export function buildMediaRangeHeaders(
  mimeType: string,
  totalBytes: number,
  range: ParsedRangeResult,
): Record<string, string> {
  const safeMime = mimeType || 'video/mp4';

  if (range.type === 'unsatisfiable') {
    return {
      'Content-Range': `bytes */${totalBytes}`,
      'Accept-Ranges': 'bytes',
      'X-CDNFREE-Cache': 'HIT',
    };
  }

  if (range.type === 'partial') {
    const chunkSize = range.end - range.start + 1;
    return {
      'Content-Type': safeMime,
      'Content-Range': `bytes ${range.start}-${range.end}/${range.totalBytes}`,
      'Content-Length': String(chunkSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000',
      'X-CDNFREE-Cache': 'HIT',
    };
  }

  return {
    'Content-Type': safeMime,
    'Content-Length': String(totalBytes),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000',
    'X-CDNFREE-Cache': 'HIT',
  };
}
