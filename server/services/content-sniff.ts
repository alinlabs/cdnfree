export type SniffedKind =
  | 'html'
  | 'hls'
  | 'dash'
  | 'video'
  | 'audio'
  | 'image'
  | 'pdf'
  | 'font'
  | 'archive'
  | 'json'
  | 'binary'
  | 'empty';

const TS_PACKET = 0x47;

export function sniffKind(buf: Buffer): SniffedKind {
  if (buf.length === 0) return 'empty';
  const ascii = (s: number, e: number) =>
    buf.toString('latin1', s, Math.min(e, buf.length));

  // ---- Tanda tangan biner posisional ----
  if (buf.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis' || brand === 'heic' || brand === 'mif1') {
      return 'image';
    }
    if (brand === 'crx ') return 'image';
    return 'video'; // isom, iso5, iso6, mp41, mp42, m4v, qt, dash, msdh
  }

  if (buf.length >= 4) {
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return 'video'; // EBML / WebM / MKV
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image'; // JPEG
    if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image';
    if (ascii(0, 4) === 'GIF8') return 'image';
    if (ascii(0, 2) === 'BM') return 'image';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
      return 'image'; // ICO
    }
    if (ascii(0, 4) === 'RIFF' && buf.length >= 12) {
      const tag = ascii(8, 12);
      if (tag === 'WEBP') return 'image';
      if (tag === 'WAVE') return 'audio';
      if (tag === 'AVI ') return 'video';
    }
    if (ascii(0, 4) === 'OggS' || ascii(0, 4) === 'fLaC') return 'audio';
    if (ascii(0, 3) === 'ID3') return 'audio';
    if (buf[0] === 0xff && (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)) {
      return 'audio'; // MP3 frame sync
    }
    if (buf[0] === TS_PACKET && buf.length > 189 && buf[188] === TS_PACKET) {
      return 'video'; // MPEG-TS packet sync
    }
    if (ascii(0, 5) === '%PDF-') return 'pdf';
    if (['wOFF', 'wOF2', 'OTTO', 'ttcf', 'true'].includes(ascii(0, 4))) return 'font';
    if (ascii(0, 4) === 'PK\x03\x04' || ascii(0, 4) === 'PK\x05\x06') return 'archive';
    if (ascii(0, 3) === '\x1f\x8b\x08') return 'archive'; // gzip bocor
  }

  // ---- Tanda tangan teks ----
  let i = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  while (
    i < buf.length &&
    (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)
  ) {
    i += 1;
  }
  const text = buf.toString('utf8', i, Math.min(buf.length, i + 512)).toLowerCase();

  if (text.startsWith('#extm3u')) return 'hls';
  if (text.includes('<mpd') || text.includes('urn:mpeg:dash:schema')) return 'dash';
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'image';
  }
  if (
    /^<(!doctype\s+html|html|head|body|script|meta|title|div|iframe|style|link|noscript|table|form|main|section|p\b)/.test(
      text,
    )
  ) {
    return 'html';
  }
  if (text.startsWith('<') && text.includes('>')) return 'html';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';

  // ---- Fallback rasio printable ----
  const sample = buf.subarray(0, 512);
  let printable = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || b >= 32) printable += 1;
  }
  return printable / sample.length > 0.9 ? 'json' : 'binary';
}

export function mimeFromKind(kind: SniffedKind): string {
  switch (kind) {
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'image':
      return 'image/jpeg';
    case 'pdf':
      return 'application/pdf';
    case 'hls':
      return 'application/vnd.apple.mpegurl';
    case 'dash':
      return 'application/dash+xml';
    case 'html':
      return 'text/html; charset=utf-8';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

export function refineMime(kind: SniffedKind, buf: Buffer): string {
  if (kind === 'video') {
    if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
      const brand = buf.toString('latin1', 8, 12).toLowerCase();
      if (brand === 'qt  ') return 'video/quicktime';
      return 'video/mp4';
    }
    if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      const header = buf.toString('latin1', 0, Math.min(buf.length, 64)).toLowerCase();
      return header.includes('webm') ? 'video/webm' : 'video/x-matroska';
    }
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'AVI ') {
      return 'video/x-msvideo';
    }
    if (buf.length > 189 && buf[0] === TS_PACKET && buf[188] === TS_PACKET) {
      return 'video/mp2t';
    }
    return 'video/mp4';
  }

  if (kind === 'image') {
    if (buf.length >= 4 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') {
      return 'image/png';
    }
    if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GIF8') {
      return 'image/gif';
    }
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
    if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
      const brand = buf.toString('latin1', 8, 12).toLowerCase();
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      return 'image/heic';
    }
    if (buf.length >= 2 && buf.toString('latin1', 0, 2) === 'BM') return 'image/bmp';
    if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
      return 'image/x-icon';
    }
    const text = buf.toString('utf8', 0, Math.min(buf.length, 512)).trimStart().toLowerCase();
    if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
      return 'image/svg+xml';
    }
    return 'image/jpeg';
  }

  if (kind === 'audio') {
    if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
    if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'fLaC') return 'audio/flac';
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') {
      return 'audio/wav';
    }
    return 'audio/mpeg';
  }

  return mimeFromKind(kind);
}
