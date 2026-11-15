# Blueprint Implementasi Aksesibilitas & Ekstraksi Aset — CDNFREE

Dokumen ini merapikan spesifikasi implementasi 25 bagian dari `get-assets.md` secara visual agar terstruktur dengan baik sebagai referensi implementasi berbasis **pencocokan arsitektur (architecture-matched)** pada codebase CDNFREE tanpa merusak UI, keamanan anti-SSRF IP-pinning, Zod schema, maupun modul yang sudah berjalan.

---

## 0. Ringkasan Arsitektur yang Dibangun

Tiga lapisan baru yang ditambahkan ke CDNFREE:
1. **Deteksi berbasis byte** (`sniffKind` + `reconcile`) agar jenis payload diputuskan dari **2048 byte pertama**, bukan sekadar ekstensi URL atau header `Content-Type`.
2. **Ladder header per-host yang belajar sendiri** (`HEADER_LADDER` + `header-profile-store`) untuk melewati hotlink guard/403 secara adaptif.
3. **Proxy playlist HLS yang mewarisi token** (`/api/hls/:sid/:assetId` + `hls-playlist` + `hls-remint`) dan **streaming download hingga 2 GiB** tanpa buffer penuh.

```text
hop → fetchHeadBytes(2048 B, identity) → sniffKind → reconcile
                                                        ├─ html  → classifyHtmlPage → { follow | harvest }
                                                        ├─ hls   → ResourceRecord(hls) → /api/hls/:sid/:assetId
                                                        ├─ video → probe(verified) → /api/assets/stream | download
                                                        └─ lain  → ResourceRecord(unverified)
```

---

## 1. Struktur File & Pemetaan ke Repo CDNFREE

| Komponen Blueprint | Pemetaan File di CDNFREE | Keterangan Pencocokan |
| :--- | :--- | :--- |
| `server/config/limits.ts` | `server/config/limits.ts` (baru) | Membaca env `SNIFF_BYTES`, `SNIFF_TIMEOUT_MS`, `MAX_MEDIA_BYTES`, mendefinisikan `HEADER_LADDER`, `RETRYABLE_STATUS`. |
| `server/types/asset.ts` | `server/types/server.ts`, `src/types/inspection.ts`, `src/services/inspection-service.ts` | Penambahan aditif pada `AssetKind`, `AssetProbeInfo['reason']`, `referer`, `depth`, `hlsUrl` & sinkronisasi Zod schema. |
| `server/services/content-sniff.ts` | `server/services/content-sniff.ts` (baru) | Fungsi murni (`sniffKind`, `mimeFromKind`, `refineMime`), tanpa I/O, diuji unit dengan `node:test`. |
| `server/services/reconcile.ts` | `server/services/reconcile.ts` (baru) | Rekonsiliasi `declaredMime` vs `sniffedKind` dan deteksi `html-wrapper`. |
| `server/services/header-profile-store.ts` | `server/services/header-profile-store.ts` (baru) | Cache strategi header per-host (TTL 1 jam, LRU 500 entri). |
| `server/services/http-headers.ts` | `server/services/http-headers.ts` (baru) | Pembangun header adaptif per `HeaderMode` dengan `Accept-Encoding: identity`. |
| `server/services/fetch-head-bytes.ts` | `server/services/fetch-head-bytes.ts` (baru) | Menggunakan transport **IP-pinned `node:http`/`node:https`** milik CDNFREE (pengganti `undici`) agar anti-SSRF tetap terjaga. |
| `server/services/client-redirect.ts` | `server/services/client-redirect.ts` (diperbarui) | Menambahkan `classifyHtmlPage` dengan cek `MEDIA_ELEMENT_RE` terlebih dahulu sebelum mengikuti redirect JS/meta. |
| `server/services/unescape-url.ts` | `server/services/unescape-url.ts` (baru) | Mendekode `\u0026`, `\u003d`, `\u003f`, `\u002f`, `&amp;`, `\x26` sebelum ekstraksi URL. |
| `server/services/asset-rules.ts` | `server/services/asset-rules.ts` (diperbarui) | Ekspansi selector (`[src]:not(...)`, `[data-embed]`, `[data-iframe]`, `[data-player]`, `[itemprop="embedUrl"]`). |
| `server/services/deep-asset-scanner.ts` | `server/services/deep-asset-scanner.ts` (diperbarui) | Integrasi `unescapeUrlText`, `walkJsonForUrls`, dan playlist `.m3u8`/`.mpd` sebagai aset kelas satu (`hls`/`dash`). |
| `server/services/asset-probe.ts` | `server/services/asset-probe.ts` (diperbarui) | Probe berbasis `fetchHeadBytes` + `HEADER_LADDER` + `sniffKind` + `reconcile` (kompatibel dengan kontrak tes yang ada). |
| `server/services/redirect-inspector.ts` & `asset-pipeline-bridge.ts` | `server/services/redirect-inspector.ts`, `server/services/asset-pipeline-bridge.ts` | Gerbang keputusan berbasis `sniffKind` + `reconcile` untuk `wrapper`, `hls`/`dash`, dan media langsung. |
| `server/services/hls-playlist.ts` | `server/services/hls-playlist.ts` (baru) | Rewriter URI & atribut `URI="..."`, pewarisan query token pada origin sama, parser segmen & expiry. |
| `server/services/hls-remint.ts` | `server/services/hls-remint.ts` (baru) | Re-mint URL HLS satu kali saat root mengembalikan `403` dan token mendekati/melewati kedaluwarsa. |
| `server/routes/hls-route.ts` | `server/routes/hls-route.ts` (baru) | Route `/api/hls/:sid/:assetId` (proxy playlist + segmen IP-pinned + validasi SSRF tiap anak). |
| `server/routes/download-route.ts` | `server/routes/download-route.ts` & `server/services/asset-downloader.ts` |Streaming download hingga `MAX_MEDIA_BYTES` (2 GiB), dukungan unduh HLS via `hls-downloader.ts`, blokir `html-wrapper`. |
| `server/services/hls-downloader.ts` | `server/services/hls-downloader.ts` (baru) | Pengunduh segmen HLS dengan konkurensi terbatas (`4`), batas `4000` segmen, remux `ffmpeg` opsional. |
| `server/routes/proxy-route.ts` | `server/services/proxy/frame.ts` & `server/routes/proxy-route.ts` | Memastikan header frameable di proxy tidak menimpa keamanan aplikasi utama. |
| `app/components/AssetPlayer.tsx` | `src/pages/hasil-pencarian/media-player/use-hls-player.ts`, `custom-video-player.tsx`, `video-mini-card.tsx`, `asset-preview-policy.ts`, `asset-explorer.ts` | Integrasi `hls.js` ke pemutar video yang sudah ada tanpa mengubah layout UI; HLS selalu diputar lewat `/api/hls/:sid/:assetId`. |
| `tests/inspect.integration.test.ts` | `tests/unit/content-sniff.test.ts` & `tests/integration/asset-accessibility.test.ts` | Ditulis dengan `node:test` + server HTTP lokal deterministik (pengganti `vitest` & jaringan publik raw). |

---

## 2. `server/config/limits.ts`

```ts
export const SNIFF_BYTES = 2048;
export const SNIFF_TIMEOUT_MS = 12_000;
export const HOP_BUDGET_MS = 15_000;
export const MAX_REDIRECT_HOPS = 8;
export const MAX_PROBE_DEPTH = 2;
export const MAX_FRAMES = 8;
export const MAX_PLAYLISTS = 3;

/** Batas unduhan tunggal. Media tidak lagi dibatasi 10 MiB. */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
/** Batas untuk non-media (dokumen/gambar) tetap ketat. */
export const MAX_SMALL_BYTES = 25 * 1024 * 1024;

export const HLS_SEGMENT_CONCURRENCY = 4;
export const HLS_MAX_SEGMENTS = 4000;
export const HLS_REMINT_WINDOW_SEC = 60;

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const HEADER_LADDER = ['page-origin', 'none', 'host-root'] as const;
export type HeaderMode = (typeof HEADER_LADDER)[number];

export const RETRYABLE_STATUS = new Set([401, 403, 406, 429, 451, 503]);
```

---

## 3. Tipe Aset (`server/types/server.ts` & `src/types/inspection.ts`)

Tambahan union pada `AssetKind` dan properti `ResourceRecord` (disinkronkan dengan `InspectionResultSchema` di `src/services/inspection-service.ts`):

```ts
export type AssetFormat =
  | 'video' | 'audio' | 'image' | 'document' | 'other'
  | 'wrapper' | 'hls' | 'dash' | 'embed';

export type ProbeStatus = 'verified' | 'unverified' | 'dead';

export interface ProbeState {
  status: ProbeStatus;
  reason: string;
  mime: string | null;
  checkedAt: number;
}

export interface ResourceRecord {
  id: string;
  url: string;
  format: AssetFormat;
  label: string;
  /** mime hasil sniff, bukan header. Null bila belum terverifikasi. */
  mime: string | null;
  declaredBytes: number | null;
  posterUrl: string | null;
  referer: string | null;
  depth: number;
  probe: ProbeState;
  source: 'direct' | 'static' | 'data-attr' | 'script' | 'json' | 'iframe' | 'runtime';
}

export interface InspectionTarget {
  /** URL yang dimasukkan pengguna, dipakai untuk re-mint token HLS. */
  targetUrl: string;
  finalUrl: string;
}
```

---

## 4. `server/services/content-sniff.ts`

Fungsi murni, tanpa I/O, diuji unit.

```ts
export type SniffedKind =
  | 'html' | 'hls' | 'dash' | 'video' | 'audio' | 'image'
  | 'pdf' | 'font' | 'archive' | 'json' | 'binary' | 'empty';

const TS_PACKET = 0x47;

export function sniffKind(buf: Buffer): SniffedKind {
  if (buf.length === 0) return 'empty';
  const ascii = (s: number, e: number) =>
    buf.toString('latin1', s, Math.min(e, buf.length));

  // ---- tanda tangan biner (posisional) ----
  if (buf.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis' || brand === 'heic' || brand === 'mif1') return 'image';
    if (brand === 'crx ') return 'image';
    return 'video'; // isom, iso5, iso6, mp41, mp42, M4V, dash, msdh
  }
  if (buf.length >= 4) {
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video'; // EBML
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
    if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image';
    if (ascii(0, 4) === 'GIF8') return 'image';
    if (ascii(0, 2) === 'BM') return 'image';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image';
    if (ascii(0, 4) === 'RIFF') {
      const tag = ascii(8, 12);
      if (tag === 'WEBP') return 'image';
      if (tag === 'WAVE') return 'audio';
      if (tag === 'AVI ') return 'video';
    }
    if (ascii(0, 4) === 'OggS' || ascii(0, 4) === 'fLaC') return 'audio';
    if (ascii(0, 3) === 'ID3') return 'audio';
    if (buf[0] === 0xff && (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)) return 'audio';
    if (buf[0] === TS_PACKET && buf.length > 189 && buf[188] === TS_PACKET) return 'video';
    if (ascii(0, 5) === '%PDF-') return 'pdf';
    if (['wOFF', 'wOF2', 'OTTO', 'ttcf', 'true'].includes(ascii(0, 4))) return 'font';
    if (ascii(0, 4) === 'PK\x03\x04' || ascii(0, 4) === 'PK\x05\x06') return 'archive';
    if (ascii(0, 3) === '\x1f\x8b\x08') return 'archive'; // gzip bocor
  }

  // ---- tanda tangan teks ----
  let i = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  const text = buf.toString('utf8', i, Math.min(buf.length, i + 512)).toLowerCase();

  if (text.startsWith('#extm3u')) return 'hls';
  if (text.includes('<mpd') || text.includes('urn:mpeg:dash:schema')) return 'dash';
  if (/^<(!doctype\s+html|html|head|body|script|meta|title|div|iframe|svg|style|link|noscript|table|form|main|section|p\b)/.test(text))
    return 'html';
  if (text.startsWith('<') && text.includes('>')) return 'html';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';

  // ---- fallback rasio printable ----
  const sample = buf.subarray(0, 512);
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || b >= 32) printable++;
  return printable / sample.length > 0.9 ? 'json' : 'binary';
}

export function mimeFromKind(kind: SniffedKind): string {
  switch (kind) {
    case 'video': return 'video/mp4';
    case 'audio': return 'audio/mpeg';
    case 'image': return 'image/jpeg';
    case 'pdf': return 'application/pdf';
    case 'hls': return 'application/vnd.apple.mpegurl';
    case 'dash': return 'application/dash+xml';
    case 'html': return 'text/html; charset=utf-8';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}
```

> Catatan: `mimeFromKind` mengembalikan nilai generik; `refineMime(kind, buf)` dapat membaca magic byte spesifik (`ftyp` qt vs mp4, PNG, WebP, GIF, AVIF, SVG, WebM) untuk akurasi penuh.

---

## 5. `server/services/reconcile.ts`

Pengganti keputusan naif berbasis header pada `isDirectInspectableAssetContentType`:

```ts
import { SniffedKind } from './content-sniff';

export type DeclaredKind =
  | 'html' | 'video' | 'audio' | 'image' | 'pdf' | 'font' | 'json' | 'other';

export function kindFromMime(mime: string | null): DeclaredKind | null {
  if (!mime) return null;
  const m = mime.toLowerCase();
  if (m.startsWith('text/html') || m.startsWith('application/xhtml')) return 'html';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('application/pdf')) return 'pdf';
  if (m.startsWith('font/') || m.includes('woff')) return 'font';
  if (m.includes('json')) return 'json';
  return 'other';
}

export interface ReconcileResult {
  kind: DeclaredKind | 'hls' | 'dash' | 'binary' | 'empty';
  mime: string | null;
  /** true bila body HTML tapi header/ekstensi mengklaim media. */
  wrapper: boolean;
  lowConfidence: boolean;
}

export function reconcile(declaredMime: string | null, sniffed: SniffedKind): ReconcileResult {
  if (sniffed === 'html') {
    const declared = kindFromMime(declaredMime);
    return {
      kind: 'html',
      mime: 'text/html; charset=utf-8',
      wrapper: declared !== null && declared !== 'html',
      lowConfidence: false,
    };
  }
  if (sniffed === 'hls' || sniffed === 'dash') {
    return { kind: sniffed, mime: mimeOf(sniffed), wrapper: false, lowConfidence: false };
  }
  if (sniffed === 'video' || sniffed === 'audio' || sniffed === 'image' || sniffed === 'pdf' || sniffed === 'font') {
    return { kind: sniffed, mime: mimeOf(sniffed), wrapper: false, lowConfidence: false };
  }
  const declared = kindFromMime(declaredMime);
  return {
    kind: declared ?? (sniffed === 'empty' ? 'empty' : 'binary'),
    mime: declaredMime,
    wrapper: false,
    lowConfidence: true,
  };
}
```

---

## 6. `server/services/header-profile-store.ts`

Belajar per host. TTL 1 jam, LRU 500 entri.

```ts
import { HeaderMode } from '../config/limits';

interface Profile {
  mode: HeaderMode;
  referer: string | null;
  origin: string | null;
  failures: number;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;
const store = new Map<string, Profile>();

export function getProfile(host: string): Profile | undefined {
  const p = store.get(host);
  if (!p) return undefined;
  if (p.expiresAt < Date.now()) { store.delete(host); return undefined; }
  return p;
}

export function recordSuccess(host: string, mode: HeaderMode, referer: string | null, origin: string | null): void {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  store.set(host, { mode, referer, origin, failures: 0, expiresAt: Date.now() + TTL_MS });
}

export function recordFailure(host: string): void {
  const p = store.get(host);
  if (!p) return;
  p.failures += 1;
  if (p.failures >= 3) store.delete(host);
}

export function reset(): void { store.clear(); }
```

---

## 7. `server/services/http-headers.ts`

```ts
import { CHROME_UA, HeaderMode } from '../config/limits';

export function buildHeaders(
  targetUrl: string,
  pageUrl: string | null,
  mode: HeaderMode,
): Record<string, string> {
  const host = new URL(targetUrl).hostname;
  const headers: Record<string, string> = {
    'user-agent': CHROME_UA,
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    // WAJIB identity: body ter-gzip akan merusak deteksi magic byte
    'accept-encoding': 'identity',
    'sec-fetch-dest': 'video',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  };

  if (mode === 'page-origin' && pageUrl) {
    const origin = new URL(pageUrl).origin;
    headers.referer = pageUrl;
    headers.origin = origin;
  } else if (mode === 'host-root') {
    headers.referer = `https://${host}/`;
  }
  return headers;
}
```

---

## 8. `server/services/fetch-head-bytes.ts`

Satu hop tanpa auto-redirect sehingga inspector mengendalikan loop dan validasi SSRF setiap hop (diimplementasikan di CDNFREE dengan `node:http`/`node:https` IP-pinned `ValidatedTarget`).

```ts
export interface HeadBytesResult {
  status: number;
  location: string | null;
  declaredType: string | null;
  declaredBytes: number | null;
  buf: Buffer;
}

/** `bytes 0-2047/146681790` → 146681790. `Content-Length` hanya dipakai untuk 200 penuh. */
export function parseTotalBytes(contentRange: string | null, contentLength: string | null): number | null {
  if (contentRange) {
    const total = /\/(\d+)\s*$/.exec(contentRange);
    if (total) return Number(total[1]);
    return null;
  }
  if (contentLength) {
    const n = Number(contentLength);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
```

---

## 9. `server/services/client-redirect.ts`

Penjaga utamanya adalah keberadaan elemen media (`MEDIA_ELEMENT_RE`) — menyelamatkan halaman seperti `slicedrivi` yang menyisipkan `window.location.href` jebakan.

```ts
import { MAX_REDIRECT_HOPS } from '../config/limits';

const MEDIA_ELEMENT_RE =
  /<(video|audio|source|track|iframe|embed|object|picture)\b|og:video|twitter:player:stream|__NEXT_DATA__|__VX_BOOTSTRAP_VIDEO__|\.m3u8|\.mpd/i;

const LOCATION_NAV_RE =
  /\blocation\s*(?:\.\s*href\s*)?=(?!=)|location\s*\.\s*(?:replace|assign)\s*\(|location\s*\[\s*['"]href['"]\s*\]\s*=/;

const META_REFRESH_RE =
  /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*(\d+)\s*[;,]?\s*(?:url\s*=\s*)?([^"'>]*)/i;

export interface RedirectDecision {
  follow: boolean;
  reason: 'meta-refresh' | 'js-stub' | 'has-media' | 'no-nav' | 'no-body';
  delaySec: number | null;
  target: string | null;
}

export function classifyHtmlPage(html: string, refreshHeader: string | null): RedirectDecision {
  if (!html.trim()) return { follow: false, reason: 'no-body', delaySec: null, target: null };

  const hasMedia = MEDIA_ELEMENT_RE.test(html);

  const meta = META_REFRESH_RE.exec(html);
  const headerDelay = refreshHeader ? Number(/\d+/.exec(refreshHeader)?.[0] ?? NaN) : NaN;
  const delay = Number.isFinite(headerDelay) ? headerDelay : meta ? Number(meta[1]) : null;
  const metaTarget = meta?.[2]?.trim() || null;

  if (delay !== null && delay <= MAX_REDIRECT_HOPS && !hasMedia) {
    return { follow: true, reason: 'meta-refresh', delaySec: delay, target: metaTarget };
  }

  if (hasMedia) return { follow: false, reason: 'has-media', delaySec: delay, target: null };

  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  if (text.length < 400 && LOCATION_NAV_RE.test(html)) {
    return { follow: true, reason: 'js-stub', delaySec: delay, target: extractFirstLocationTarget(html) };
  }

  return { follow: false, reason: 'no-nav', delaySec: delay, target: null };
}
```

---

## 10. `server/services/unescape-url.ts`

Wajib dijalankan sebelum regex URL agar token HLS bertanda `&` ter-escape tidak rusak.

```ts
export function unescapeUrlText(raw: string): string {
  return raw
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/\\x26/g, '&');
}
```

---

## 11. `server/services/asset-rules.ts`

Ekspansi selector termasuk `[src]:not(...)` untuk menangkap elemen kustom (`div[src]`), `[data-embed]`, `[data-iframe]`, `[data-player]`, serta `[itemprop="embedUrl"]`.

---

## 12. `server/services/deep-asset-scanner.ts`

- Memanggil `unescapeUrlText(html)` sebelum memindai URL/JSON.
- Menyisir blok `window.__*__` dan `<script type="application/(ld+)?json">` dengan `walkJsonForUrls`.
- Memperlakukan playlist `.m3u8` dan `.mpd` sebagai aset kelas satu (`hls` / `dash`), bukan hanya dipanen segmen `.ts`-nya.

---

## 13. `server/services/asset-probe.ts`

- Menguji kandidat menggunakan `fetchHeadBytes` + `HEADER_LADDER` + `header-profile-store`.
- Menggunakan `sniffKind(buf)` + `reconcile(declaredType, sniffed)`:
  - `video | audio | image | pdf | vector` → `probe.status = 'verified'`
  - HTML dengan ekstensi/MIME media (`verdict.wrapper === true`) → `probe.status = 'unverified'`, `reason: 'html-wrapper'`, sekaligus mengekstrak HTML pembungkus bila `depth < MAX_PROBE_DEPTH`.
  - `hls | dash` → aset playlist terklasifikasi `hls` / `dash`.

---

## 14. `server/services/redirect-inspector.ts`

Mengganti gerbang keputusan pada tiap hop dengan `fetchHeadBytes` → `sniffKind` → `reconcile`:
- `verdict.kind === 'html'`: ambil HTML penuh, catat `wrapperRecord` jika `verdict.wrapper`, cek `classifyHtmlPage` dan `harvest`, ikuti redirect jika `decision.follow && !hasHarvest`.
- `verdict.kind === 'hls' | 'dash'`: catat sebagai playlist kelas satu.
- `verdict.kind === 'video' | 'audio' | 'image' | 'pdf'`: catat sebagai media terverifikasi.

---

## 15–17. Ekosistem Proxy HLS (`hls-playlist.ts`, `hls-route.ts`, `hls-remint.ts`)

- `rewritePlaylist(body, ctx)`: menulis ulang setiap baris segmen/varian non-komentar dan atribut `URI="..."` menjadi `/api/hls/:sid/:assetId?u=<base64url>`.
- Pewarisan token: jika URI anak tidak memiliki query string dan `origin === tokenOrigin`, warisi `tokenQuery` dari playlist induk.
- `GET /api/hls/:sid/:assetId`: memvalidasi setiap URL anak lewat `resolveAndValidateUrl`, mengirim header adaptif + `referer`, melakukan `reMintPlaylist` 1 kali jika root mendapat `403` dan token kedaluwarsa, serta meneruskan segmen biner dengan `Accept-Ranges: bytes`.

---

## 18–19. Unduhan Streaming 2 GiB & Pengunduh HLS (`download-route.ts`, `hls-downloader.ts`)

- Batas media dinaikkan ke `MAX_MEDIA_BYTES` (2 GiB), non-media tetap `MAX_SMALL_BYTES` (25 MiB).
- Unduhan di-stream langsung tanpa buffering penuh di RAM; menolak `html-wrapper` atau konten berisiko (`DANGEROUS_DOWNLOAD_MIMES`).
- Aset `hls` diunduh per segmen dengan konkurensi `HLS_SEGMENT_CONCURRENCY = 4`, batas `HLS_MAX_SEGMENTS = 4000`, dan remux `ffmpeg` opsional jika biner `ffmpeg` tersedia di sistem.

---

## 20. `server/routes/proxy-route.ts`

Memastikan respons proxy menghilangkan `X-Frame-Options` / `frame-ancestors` pembatas dengan aman sesuai kebijakan frameable CDNFREE.

---

## 21. Pemutar Media (`hls.js` di `CustomVideoPlayer` & `VideoMiniCard`)

- HLS selalu diarahkan ke `/api/hls/:sid/:assetId` (melalui `hls.js` dengan `enableWorker: true, lowLatencyMode: false, maxBufferLength: 30` atau native HLS di Safari) — **tidak pernah** memutar URL `.m3u8` mentah langsung dari browser.
- URL bertipe `wrapper` / `html-wrapper` tidak ditampilkan sebagai video yang bisa diputar.

---

## 22–24. Pengujian & Konfigurasi Env

Variabel `.env.example` (non-rahasia):

```env
SNIFF_BYTES=2048
SNIFF_TIMEOUT_MS=12000
MAX_MEDIA_BYTES=2147483648
```

Pengujian unit & integrasi dijalankan menggunakan runner `node:test` (`npm test`) secara deterministik via server HTTP lokal dan kasus-kasus nyata:
1. `302` → HTML wrapper → `mp4`
2. HTML wrapper → `mp4`
3. Interstitial → token HLS ter-escape (`\u0026`, `&amp;`) → proxy `/api/hls` mewarisi query token
4. Halaman `<video>` dengan JS redirect jebakan (`window.location.href` ke domain eksternal) tetap bertahan dan mengekstrak video asli.

---

## 25. Sembilan Aturan Wajib (Non-Negotiable)

1. Jenis payload **HANYA** ditentukan oleh `sniffKind()` dari 2048 byte pertama. `Content-Type` dan ekstensi path hanya dipakai sebagai pembanding di `reconcile()`.
2. `probe.status = 'verified'` hanya boleh diberikan bila `sniffKind` mengembalikan `video | audio | image | pdf` (atau `vector` SVG yang terverifikasi). HTML yang mengklaim media harus berstatus `'unverified'` dengan reason `'html-wrapper'`.
3. `fetchHeadBytes` **WAJIB** mengirim `Accept-Encoding: identity`, agar deteksi magic byte tidak rusak oleh gzip.
4. `classifyHtmlPage` **WAJIB** mengecek `MEDIA_ELEMENT_RE` lebih dulu. Halaman dengan `<video>`/`<source>`/`<iframe>`/`og:video` **TIDAK** boleh diikuti sebagai redirect, walau di dalamnya ada `window.location.href`.
5. Token HLS harus utuh: dekode `\u0026 \u003d \u003f \u002f` dan `&amp;` sebelum regex URL. URI anak tanpa query mewarisi query induk bila origin sama.
6. Playlist `.m3u8`/`.mpd` adalah `ResourceRecord` dengan `assetKind: 'hls' | 'dash'`, bukan bahan panen segmen mentah.
7. `MAX_ASSET_DOWNLOAD_BYTES` (10 MiB) tidak dipakai lagi untuk media; gunakan `MAX_MEDIA_BYTES` (2 GiB) dengan streaming.
8. Setiap hop anak di `hls-route` dan `download-route` wajib melewati `resolveAndValidateUrl` (anti-SSRF + IP-pinning).
9. Jangan merusak/mengubah: parsing input, mode bulk, filter engine, sanitasi SVG, skema Zod, dan tata letak UI yang sudah ada.