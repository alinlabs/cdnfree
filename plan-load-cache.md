# Rencana Arsitektur Smart Load, Kontinuitas Playback, & SmartCache Offline Video (CDNFREE)

> **Status**: Dokumen Analisis & Rencana Implementasi (Belum Dieksekusi)  
> **Cakupan**: Halaman **Aset Manager** (`/search`), **Markah** (`/markah`), **Riwayat** (`/riwayat`), **VideoMiniCard**, **CustomVideoPlayer** (`MediaFullView`), Backend Stream/Proxy, dan Root **SmartCache Service Worker**.  
> **Prinsip Utama**: Seluruh perubahan tetap mempertahankan UI/tema CDNFREE, proteksi SSRF *IP-pinning*, validasi Zod, isolasi Service Worker Scramjet (`/p/`), serta batas panjang file `<= 600` baris.

---

## Ringkasan Tujuan

1. **Fast & Reliable Video Loading**: Menghilangkan jeda gagal *direct-first*, kemacetan slot koneksi grid (12 card sekaligus), serta kegagalan video di halaman Markah yang kehilangan metadata sesi.
2. **Seamless Card ↔ Full View Time Continuity**: Menjaga posisi menit/detik (`currentTime`), status putar, dan sumber stream pemenang saat berpindah dari **VideoMiniCard → Full Mode View** maupun sebaliknya (**Full Mode View → VideoMiniCard**), termasuk saat filter/route berubah.
3. **True Offline SmartCache**: Setiap video yang diputar (baik MP4/WebM progresif maupun HLS `.m3u8` bertoken) secara cerdas dimuat utuh ke penyimpanan lokal persisten browser di latar belakang sehingga dapat diputar ulang secara **offline penuh**, lengkap dengan dukungan HTTP `206 Partial Content` (*byte-range seeking*) dan pembersihan kuota LRU.

---

## Bagian 1 — Analisis Kondisi Kode Saat Ini (Root Cause Audit)

### 1.1 Masalah Kecepatan & Keandalan Loading Video
- **Direct-first fallback delay** (`src/pages/hasil-pencarian/aset/video-mini-card.tsx:125,303-315` dan `src/pages/hasil-pencarian/media-player/custom-video-player.tsx:89,413-424`):
  - Kedua pemutar selalu memasang `activeSrc = resource.url` (langsung ke CDN eksternal) terlebih dahulu. Jika CDN memblokir hotlink/CORS atau lambat timeout, user harus menunggu gagal `onError` (1–8 detik) sebelum beralih ke `streamSrc` (`/api/assets/stream/...` atau `/api/asset?...`).
  - Saat user membuka Full View setelah MiniCard sudah menemukan `useStreamFallback = true`, `CustomVideoPlayer` mereset `useStreamFallback = false` sehingga **mengulang kegagalan dari awal**.
- **Saturasi Koneksi di Grid** (`src/pages/hasil-pencarian/aset/video-gallery.tsx:24,106`, `video-mini-card.tsx:235,256-274`, `src/hooks/use-in-view.ts:3`):
  - Hingga 12 `VideoMiniCard` masuk viewport (`rootMargin = '220px'`) bersamaan dan masing-masing langsung memasang `<video preload="metadata">` + memanggil seek frame awal `v.currentTime = Math.min(0.35, ...)` + `canvas.toDataURL(...)`.
  - Untuk video HLS, `useHlsPlayer` (`src/pages/hasil-pencarian/media-player/use-hls-player.ts:35-66`) langsung memanggil `hls.loadSource(...)` pada semua kartu HLS di viewport sehingga browser mengantre di batas ~6 koneksi TCP paralel per origin, mencekik video yang benar-benar diklik user.
- **Kesenjangan Halaman Markah (`/markah`)** (`src/pages/markah/index.tsx:303,318`, `src/services/bookmark-service.ts:549-567`):
  - `MediaBookmark` saat ini tidak menyimpan `assetKind` (`'hls'`), `hlsUrl`, atau `referer` (hanya `sourcePageUrl`). Ketika `bookmarkToResourceRecord()` mengonversi bookmark, video `.m3u8` atau video butuh `Referer` kehilangan konteks inspeksinya dan jatuh ke `/api/asset?u=...` tanpa profil header.
- **Overhead Header Retry per Byte-Range di Backend** (`server/routes/stream-route.ts:140-168` dan `server/routes/proxy-route.ts:401-434`):
  - Pada setiap permintaan `Range: bytes=...` saat video diputar atau di-seek, `stream-route.ts` selalu mencoba `Referer` dulu lalu retry tanpa `Referer` jika 401/403/406, alih-alih langsung memakai mode pemenang dari `header-profile-store.ts`.

### 1.2 Masalah Kontinuitas Waktu (Card ↔ Full View)
- `VideoMiniCard` menyimpan `currentTime` hanya di React state lokal (`video-mini-card.tsx:107`), sedangkan `CustomVideoPlayer` mereset `setCurrentTime(0)` setiap mount/ganti item (`custom-video-player.tsx:112`).
- `handleZoomToFullView` (`video-mini-card.tsx:208-215`) mem-pause video card dan memanggil `onOpenFullView()` tanpa menyimpan `currentTime`, `wasPlaying`, ataupun sumber stream yang sedang aktif.
- Ketika `MediaFullView` ditutup (`onClose`), tidak ada mekanisme sinkronisasi balik ke `VideoMiniCard` (atau ke `sessionStorage`), sehingga card tetap berada di waktu sebelum zoom (atau `00:00`).

### 1.3 Mengapa Cache Browser Biasa Gagal untuk Video Offline
- Pemutaran `<video>` HTML5 memakai request **`206 Partial Content`** (`Range: bytes=x-y`). HTTP cache standar sering tidak menyatukan potongan-potongan range menjadi file utuh untuk akses offline.
- Spesifikasi standar browser **Cache API (`CacheStorage`) menolak menyimpan respons status `206`** (`cache.put` melempar `TypeError: Partial response (status code 206) is unsupported`).
- Service Worker yang ada saat ini (`public/proxy/sw.js`) **hanya aktif pada scope `/p/`** (untuk proxy Scramjet), sehingga rute utama (`/`, `/search`, `/markah`, `/api/assets/stream/*`, `/api/hls/*`, `/api/asset`) belum memiliki layer offline maupun synthesizer `206 Partial Content`.
- Manifest HLS bertanda tangan (`hdnts=...`, `Expires=...`, `Signature=...`) akan kedaluwarsa di kemudian hari jika tidak ditulis ulang ke URL kanonik lokal di SmartCache.

---

## Bagian 2 — Arsitektur Solusi Terpadu

```text
[ VideoMiniCard / CustomVideoPlayer ]
        │
        ├─(1) Cek VideoPlaybackSessionStore (currentTime, wasPlaying, sourceMode)
        ├─(2) Cek SmartCache Index (IndexedDB) ──► Ada Offline? ──► Putar via /smartcache/... (0ms network)
        ├─(3) Pilih Jalur Tercepat (SmartSourceResolver: hls | cache | stream | direct)
        │        └─ Dijadwalkan oleh VideoLoadScheduler (max 2 preload metadata, prioritas kartu aktif)
        │
        ▼ (Saat playback berjalan > 1.5s)
[ SmartCache Background Hydrator (Web Worker / Stream Writer) ]
        ├─ Video Progresif (MP4/WebM): Fetch utuh 200 OK → Simpan streaming ke OPFS / CacheStorage (chunked)
        └─ Video HLS (.m3u8): Ambil manifest + semua segmen .ts/.m4s → Rewrite manifest lokal → CacheStorage
        │
        ▼
[ Root Service Worker (/sw.js, scope: '/') ]
        ├─ App Shell (/, /markah, /search, JS/CSS/font/logo) → Offline-ready
        └─ Interceptor Media & Range Request:
             ├─ Cek SmartCache (OPFS / CacheStorage) berdasarkan Canonical Key
             └─ Sintesis HTTP 206 Partial Content via Blob.slice(start, end + 1) → Seek & Putar Offline Penuh!
```

---

## Bagian 3 — Rencana Implementasi Terperinci (3 Pilar)

### Pilar 1: Fast & Reliable Video Loading

#### 1.1 Smart Initial Source Resolver (`src/utils/video-source-strategy.ts` — baru)
- Menggantikan logika statis `useStreamFallback = false` di `VideoMiniCard` dan `CustomVideoPlayer`:
  - **Prioritas 1 (SmartCache Offline)**: Jika `smartCacheRegistry.hasComplete(canonicalKey)` bernilai `true`, langsung gunakan URL virtual SmartCache (`/smartcache/v1/media?key=<hash>`) agar instan `0ms` tanpa antre jaringan.
  - **Prioritas 2 (Local Media / HLS)**: `isLocalAppMediaUrl` langsung dipakai; `isHlsResource` langsung ke `/api/hls/:sid/:assetId` (atau URL manifest SmartCache jika sudah ter-cache).
  - **Prioritas 3 (Server Stream Langsung jika Perlu Proxy)**: Jika `resource.referer` ada, atau `resource.probe?.status === 403`, atau `resource.source === 'browser-observed'` / pernah tercatat gagal direct di `VideoPlaybackSessionStore`, **langsung mulai dari `streamSrc`** (`/api/assets/stream/...` atau `/api/asset?...`) tanpa buang waktu mencoba direct URL dulu.
  - **Prioritas 4 (Direct URL dengan Fast-Fail)**: Untuk CDN publik terbuka, tetap coba direct dengan batas toleransi gagal cepat; jika gagal, langsung catat `preferredSourceMode = 'stream'` di session store sehingga kartu & Full View langsung memakai `streamSrc` selanjutnya.

#### 1.2 Antrean Preload Grid & Penghematan Koneksi (`src/services/video-load-scheduler.ts` — baru)
- Mengatasi kemacetan 12 kartu video yang bersamaan mengunduh metadata/segmen saat scroll:
  - Batasi konkurensi *background metadata/thumbnail probe* pada `VideoMiniCard` maksimal **2–3 kartu aktif sekaligus** (antrean prioritas LIFO/viewport-nearest).
  - Kartu yang sedang aktif diputar (`isActivePlayer`) atau baru dibuka di `MediaFullView` otomatis mem-pause/membatalkan task thumbnail kartu lain agar 100% bandwidth dipakai video pilihan user.
  - Untuk `VideoMiniCard` bertipe **HLS**:
    - Tambahkan opsi `autoStartLoad` di `use-hls-player.ts` (`src/pages/hasil-pencarian/media-player/use-hls-player.ts`): pada mini-card, gunakan `{ autoStartLoad: false, maxBufferLength: 10 }` lalu panggil `hls.startLoad()` hanya untuk mengambil fragmen pertama saat slot scheduler tersedia (lalu `stopLoad()` sampai user klik play), atau langsung `startLoad()` penuh saat user hover/klik putar.
    - Di `CustomVideoPlayer` (Full View), gunakan `{ autoStartLoad: true, startPosition: resumeTime, maxBufferLength: 30 }` agar segmen langsung dimuat di menit target.
- **Persistent Poster Cache**:
  - Ketika `captureVideoFramePoster` berhasil membuat thumbnail JPEG ringkas (`<= 480px`), simpan ke IndexedDB (`smartcache-posters`, TTL misal 7 hari, maks 200 entri) berbasis `canonicalKey`.
  - Saat membuka kembali halaman **Markah** atau **Riwayat**, thumbnail langsung tampil tanpa men-seek elemen `<video>`, dan `<video>` di `VideoMiniCard` boleh memakai `preload="none"` sampai di-hover atau diklik!

#### 1.3 Optimasi Backend Stream & Markah (`server/routes/stream-route.ts`, `server/routes/proxy-route.ts`, `src/services/bookmark-service.ts`)
- **`stream-route.ts`**:
  - Integrasikan `getProfile(host)` / `recordSuccess` / `recordFailure` dari `server/services/header-profile-store.ts` pada `handleStream` sehingga request `Range` ke-2 hingga ke-N langsung memakai mode header pemenang (`page-origin` vs `none`) dalam **1 upstream hop** (tanpa coba-gagal berulang).
  - Tambahkan header `Vary: Range` bila perlu dan pertahankan `Accept-Ranges: bytes` serta `ETag` agar koheren dengan Service Worker.
- **`proxy-route.ts` (`/api/asset`)**:
  - Izinkan parameter opsional `&ref=<encoded_referer>` (tervalidasi `http/https` publik) atau baca `sourcePageUrl` dari Markah, serta manfaatkan `header-profile-store.ts` agar video yang diputar dari **Markah** atau **Riwayat** (yang tidak punya `inspectionId` aktif) tetap menembus hotlink 403 secepat di Aset Manager.
- **`bookmark-service.ts` & `src/types/bookmark.ts`**:
  - Simpan metadata opsional tambahan pada `MediaBookmark`: `assetKind` (`'video' | 'hls'`), `hlsUrl` (atau raw playlist URL), `sourcePageUrl`, dan `smartCacheKey`, agar video dari Markah (termasuk HLS) tidak kehilangan kapabilitas player-nya.

---

### Pilar 2: Kontinuitas Waktu Video (Card ↔ Full View)

#### 2.1 Shared `VideoPlaybackStore` (`src/services/video-playback-store.ts` — baru)
- Kunci identitas kanonik: `getCanonicalVideoKey(resource)` berbasis URL terkanonisasi (menghapus hash, menormalkan `local-media`, serta menangani URL stream/direct agar menunjuk aset yang sama di Aset Manager, Riwayat, maupun Markah).
- State per video:
  ```ts
  interface VideoPlaybackSnapshot {
    key: string;
    currentTime: number;
    duration: number;
    wasPlaying: boolean;
    playbackRate: number;
    volume: number;
    isMuted: boolean;
    preferredSourceMode?: 'cache' | 'hls' | 'stream' | 'direct';
    updatedAt: number;
  }
  ```
- Penyimpanan hybrid:
  - **In-memory `Map` + listener pub/sub (`subscribe(key, cb)`)** untuk sinkronisasi instan antar komponen yang aktif di halaman yang sama.
  - **Persistensi ringan ke `sessionStorage` / `localStorage` (throttled, maks 200 entri LRU)**: agar saat user me-refresh atau berpindah dari Aset Manager ke Markah, posisi menit terakhir tetap diingat.

#### 2.2 Alur Card → Full Mode View (`VideoMiniCard` → `MediaFullView` → `CustomVideoPlayer`)
1. Saat user menekan tombol Zoom (`handleZoomToFullView` di `video-mini-card.tsx:208`) atau membuka Full View dari kartu video:
   - Ambil `currentTime = videoRef.current?.currentTime ?? stateCurrentTime`, `duration`, `wasPlaying = Boolean(videoRef.current && !videoRef.current.paused && !videoRef.current.ended)`, dan `preferredSourceMode` (apakah sedang pakai `cache`, `hls`, `stream`, atau `direct`).
   - Panggil `videoPlaybackStore.saveSnapshot(key, ...)` secara sinkron **sebelum** mem-pause mini-card dan memanggil `onOpenFullView()`.
   - Pastikan saat mem-pause mini-card, event `onPause` tidak menimpa `wasPlaying` yang baru saja disimpan.
2. Saat `CustomVideoPlayer` (`custom-video-player.tsx`) mount:
   - Baca snapshot dari `videoPlaybackStore.getSnapshot(key)`.
   - Jika snapshot punya `preferredSourceMode`, langsung terapkan (`useStreamFallback = true` jika `'stream'`, atau pakai SmartCache jika `'cache'`).
   - **Untuk HLS**: teruskan `startPosition: snapshot.currentTime` ke `useHlsPlayer` (`new Hls({ startPosition })`) agar `hls.js` langsung mengunduh segmen pada menit tersebut tanpa start dari 00:00.
   - **Untuk MP4/WebM/Progresif**: simpan `pendingSeekTimeRef.current = snapshot.currentTime`. Pada `onLoadedMetadata` (dan fallback `onCanPlay` jika `seekable.length > 0` terlambat pada sebagian browser), langsung set `video.currentTime = clampedTime` dan `setCurrentTime(clampedTime)`.
   - Gunakan `wasPlaying` (atau intent pembukaan modal) untuk langsung melanjutkan pemutaran mulus (`video.play()`).
   - Teruskan `playbackRate` yang disimpan bila ada.

#### 2.3 Alur Full Mode View → Card Video (`CustomVideoPlayer` → `MediaFullView` → `VideoMiniCard`)
1. Selama pemutaran di `CustomVideoPlayer`:
   - `onTimeUpdate` (throttled per 400ms), `onSeeked`, `onPause`, `onRateChange`, dan **cleanup `useEffect` / `handleClose`** di `CustomVideoPlayer` selalu melakukan `flush` waktu terkini + status `wasPlaying` ke `videoPlaybackStore`.
2. Saat `MediaFullView` ditutup (`onClose`):
   - `VideoMiniCard` berlangganan (`useEffect` + `videoPlaybackStore.subscribe(key, ...)`) atau mendeteksi perubahan saat modal Full View tertutup:
     - Jika `snapshot.currentTime > 0.2`:
       - Tandai `hasStartedRef.current = true` dan `setHasStarted(true)` agar mini-card menampilkan kontrol progress bar dan posisi waktu terbaru.
       - Sinkronkan `setCurrentTime(snapshot.currentTime)` dan geser `videoRef.current.currentTime = snapshot.currentTime` (atau lewat `pendingSeekRef` jika video belum `loadedMetadata`).
       - Sinkronkan `preferredSourceMode` jika di Full View tadi user beralih antara Direct vs Stream/Cache.
       - Putar kembali secara **muted** (`video.muted = isMuted`) bila `snapshot.wasPlaying === true` *dan* kartu terlihat di viewport (atau biarkan siap lanjut di posisi frame tersebut tanpa audio kaget — perilaku *muted resume* menjaga kontinuitas visual tanpa melanggar kebijakan autoplay browser maupun mengejutkan pengguna; dapat dijadikan konstanta perilaku yang konsisten).
3. **Navigasi Prev/Next di dalam `MediaFullView`**:
   - Sebelum berpindah ke `nextIndex`/`prevIndex`, flush waktu video saat ini ke store agar jika user kembali ke video sebelumnya atau menutup Full View, posisi setiap video yang pernah disentuh tetap terjaga!

---

### Pilar 3: SmartCache Offline Penuh (Media + App Shell + Range Synthesis)

#### 3.1 Mengapa Menggunakan Kombinasi Root SW (`/sw.js`) + OPFS / CacheStorage + IndexedDB
- **Pemisahan Scope Service Worker**:
  - `public/proxy/sw.js` tetap eksklusif mengelola scope `/p/` (Scramjet Mode Engine).
  - **Baru `public/sw.js`** didaftarkan pada scope `/` (hanya sekali di bootstrap client `src/main.tsx` / `useSmartCacheSw`), dan mengecualikan `/p/`, `/api/proxy`, `/api/inspect`, serta route dinamis non-media agar tidak pernah bentrok dengan Scramjet.
  - **Update `vercel.json`**: Tambahkan `sw\\.js` pada regex pengecualian rewrite SPA di `vercel.json:20` (`(?!api/|view$|assets/|sw\\.js|...)`) agar file `/sw.js` selalu disajikan sebagai `application/javascript`, bukan `index.html`.
- **Strategi Penyimpanan Ganda Berbasis Ukuran & Dukungan Browser**:
  - **Primary (OPFS — Origin Private File System)**: Untuk browser modern (Chromium, Safari 16.4+, Firefox 111+), tulis stream hasil fetch chunk-per-chunk langsung ke file di OPFS (`/smartcache/<sha256Key>.bin`) melalui `FileSystemWritableFileStream` di Dedicated Web Worker (`smartcache-worker.ts`).
    - *Keunggulan krusial*: File video 200 MB–1 GB tidak pernah dimuat utuh ke heap RAM JS, dan OPFS mendukung `.getFile()` yang menghasilkan object `File` berbasis disk dengan `.slice(start, end)` instan!
  - **Fallback (`CacheStorage` API)**: Jika OPFS tidak tersedia (misal konteks tertentu / browser lama), simpan `Response` `200 OK` penuh ke `caches.open('cdnfree-smartcache-media-v1')`, lalu saat dibaca gunakan `response.blob().slice(start, end + 1)`.
  - **Metadata Index (`IndexedDB`: `cdnfree-smartcache-db`)**:
    - Menyimpan daftar entri tercache: `key`, `canonicalUrl`, `filename`, `kind` (`'video' | 'hls'`), `mimeType`, `totalBytes`, `status` (`'hydrating' | 'complete' | 'error'`), `storageBackend` (`'opfs' | 'cache-api'`), `posterDataUrl`, `hlsVariantManifest`, `segmentCount`, `lastAccessedAt`, `createdAt`.
    - Juga menyimpan **Offline Library Snapshot** ringkas untuk daftar video Markah & aset terakhir agar UI `/markah` dan `/search` tetap dapat dirender saat offline.

#### 3.2 Root Service Worker & `206 Partial Content` Range Synthesizer (`public/sw.js`)
Ketika halaman mengirim request `GET` atau `HEAD` ke:
1. `/smartcache/v1/media?key=<hash>` (URL kanonik SmartCache lokal), **ATAU**
2. URL proxy media `/api/assets/stream/...` atau `/api/asset?...` (dengan parameter/header atau pencocokan tabel pemetaan `urlToKey` di IndexedDB):

Alur di dalam `/sw.js`:
1. Cek IndexedDB apakah entri untuk `key` (atau URL tersebut) berstatus `'complete'`.
2. Jika `'complete'`:
   - Ambil `File` dari OPFS (atau `Response.blob()` dari CacheStorage).
   - Periksa header `Range: bytes=start-end` pada `event.request.headers`:
     - **Tanpa `Range`** → Kembalikan `200 OK` dengan `File`/`Blob` utuh + header `Accept-Ranges: bytes`, `Content-Length`, `Content-Type`, `X-CDNFREE-Cache: HIT`.
     - **Dengan `Range`** → Hitung `start` dan `end` (mendukung `bytes=0-`, `bytes=start-end`, maupun suffix `bytes=-N`), potong `const slice = file.slice(start, end + 1)`, dan kembalikan **`new Response(slice, { status: 206, headers: { 'Content-Range': 'bytes start-end/total', 'Content-Length': ..., 'Accept-Ranges': 'bytes', 'Content-Type': mime } })`**.
     - Jika range di luar batas → kembalikan `416 Range Not Satisfiable`.
   - Update `lastAccessedAt` untuk algoritma LRU.
3. Untuk rute **HLS SmartCache** (`/smartcache/v1/hls/<key>/index.m3u8` dan `/smartcache/v1/hls/<key>/seg-<n>` atau fallback saat offline terhadap `/api/hls/:sid/:assetId`):
   - Jika offline atau aset HLS sudah `'complete'`, `/sw.js` langsung menyajikan manifest lokal `.m3u8` (dengan `Content-Type: application/vnd.apple.mpegurl`) serta setiap segmen `.ts`/`.m4s`/init `.mp4`/key AES-128 dari `CacheStorage`/`OPFS`!
4. Untuk **App Shell Offline**:
   - Precaching aset build Vite (`index.html`, `/assets/*.js`, `/assets/*.css`, `/logo.webp`, `/favicon.svg`) dengan strategi *Network-First with Cache Fallback* untuk navigasi HTML SPA (`/`, `/markah`, `/riwayat`, `/search`) dan *Cache-First* untuk aset `/assets/*` ber-hash.

#### 3.3 SmartCache Background Hydrator (`src/services/smart-cache-hydrator.ts` — baru)
- **Kapan Hydration Berjalan?**
  - Dipicu otomatis ketika video mulai **benar-benar diputar oleh user** (`playing` berjalan melewati ambang batas aman, mis. `>= 1.5 detik` playback aktif di `VideoMiniCard` maupun `CustomVideoPlayer`) **atau** saat user secara eksplisit menekan aksi simpan offline (opsional di menu kartu).
  - *Mengapa menunggu 1.5 detik?* Agar user yang hanya scroll cepat atau salah klik tidak mengunduh paksa ratusan MB, dan agar tahap awal *Time-to-First-Frame* tidak terganggu oleh unduhan paralel penuh.
- **Mekanisme Video Progresif (MP4 / WebM / MOV / dll.)**:
  1. Cek kuota (`navigator.storage.estimate()`) dan batas maksimal per file (default yang wajar mis. **512 MB** per video, dan total kuota SmartCache **1.5 GB** atau maks **35%** ruang kosong browser — dapat dikonfigurasi).
  2. Jika sudah ada di cache (`complete`) atau sedang diunduh (`hydrating`), jangan duplikasi (*deduplicated single-flight*).
  3. Jalankan fetch penuh `200 OK` (via `streamSrc` atau direct jika CORS mengizinkan, **tanpa header `Range`**) di Web Worker / background controller dengan prioritas rendah, alirkan `ReadableStream` per chunk langsung ke OPFS (`FileSystemWritableFileStream`) atau tampung ke `CacheStorage`.
  4. Jika jaringan terputus di tengah unduhan progresif, simpan catatan progress sementara atau bersihkan entri parsial agar tidak menyimpan file korup sebagai `'complete'`.
- **Mekanisme Video HLS (`.m3u8`)**:
  1. Ambil playlist root dari `/api/hls/:sid/:assetId` (yang sudah di-rewrite dan masih bertoken aktif).
  2. Jika root adalah **Master Playlist**, pilih varian resolusi terbaik yang sedang diputar oleh `hls.js` (atau varian default menengah-tinggi untuk efisiensi kuota) sehingga tidak mengunduh semua bitrate 360p+720p+1080p sekaligus.
  3. Ambil media playlist varian, parsing semua segmen (`#EXTINF` URI, `#EXT-X-MAP` init mp4, dan `#EXT-X-KEY` bila ada), unduh dengan konkurensi terbatas (`2` paralel) ke `CacheStorage` dengan key kanonik stabil `/smartcache/v1/hls/<key>/seg-<i>`.
  4. Tulis ulang media playlist agar setiap referensi mengarah ke path kanonik lokal `/smartcache/v1/hls/<key>/seg-<i>` (bebas dari token kedaluwarsa upstream!), lalu simpan sebagai `/smartcache/v1/hls/<key>/index.m3u8` dan tandai `'complete'` di IndexedDB.
  5. *Bonus kecepatan*: Pada `hls.js` online, apabila fragmen sudah tersimpan oleh SW saat diputar, hydrator dapat melewati segmen yang sudah ada (`cache.match`)!

#### 3.4 Manajemen Kuota, Eviction (LRU), & Proteksi Halaman Markah Offline
- **LRU Eviction**: Sebelum menyimpan file baru sebesar `expectedBytes`, cek total ukuran SmartCache saat ini. Jika melebihi batas (mis. `1.5 GB`), hapus entri terlama berdasarkan `lastAccessedAt` (dengan opsi memprioritaskan video yang **ada di Markah** agar tidak mudah tergeser oleh video browsing sementara!).
- **Storage Persistence**: Panggil `navigator.storage?.persist?.()` secara senyap saat SmartCache pertama kali aktif menyimpan video agar browser tidak menghapus OPFS/CacheStorage secara agresif.
- **Status Ringkas & Pengelolaan Tanpa Mengotori UI**:
  - Di `AssetInfoModal` (`src/pages/hasil-pencarian/aset/asset-info-modal.tsx`) & `VideoMiniCard` / `MediaPlayerHeader`: hanya tampilkan indikator bersih & non-intrusif (mis. badge kecil `"Offline"` saat status `'complete'` atau progress ringan di modal info), serta kontrol pembersihan SmartCache di halaman **Pengaturan** (`/pengaturan` — selaras dengan pola `use-settings.ts` yang sudah ada).

---

## Bagian 4 — Daftar File yang Akan Ditambah & Dimodifikasi (Saat Eksekusi Nanti)

### File Baru (Modular, Setiap File `<= 600` Baris)
1. `public/sw.js` — Root Service Worker: offline app shell, interceptor SmartCache, dan HTTP `206 Partial Content` range synthesizer (terpisah total dari `/public/proxy/sw.js`).
2. `src/services/video-playback-store.ts` — Registry kontinuitas waktu (`currentTime`, `wasPlaying`, `preferredSourceMode`, `playbackRate`) + persistensi `sessionStorage`/`localStorage`.
3. `src/services/video-load-scheduler.ts` — Antrean konkurensi terkendali (maks 2–3 mini-card metadata/poster serentak, prioritas active player).
4. `src/services/smart-cache-db.ts` — Wrapper IndexedDB untuk metadata SmartCache (`cdnfree-smartcache-db`), cache poster thumbnail, pemetaan URL → `canonicalKey`, dan LRU tracking.
5. `src/services/smart-cache-storage.ts` — Abstraksi penyimpanan OPFS (streaming via `WritableStream`) + fallback `CacheStorage`, plus penghitungan kuota dan LRU eviction.
6. `src/services/smart-cache-hydrator.ts` — Orkestrator background download penuh untuk MP4/WebM dan HLS (`.m3u8` + varian aktif + segmen + rewrite manifest lokal kanonik).
7. `src/hooks/use-smart-cache-sw.ts` — Registrasi `/sw.js` (scope `/`) secara aman dan sinkronisasi status offline/cache ke UI.
8. `src/utils/video-source-strategy.ts` — Penentu jalur awal pemutaran tercepat (`cache` → `local/hls` → `stream` → `direct`) berdasarkan status cache, profil probe, dan history session.

### File yang Dimodifikasi Secara Bedah (*Surgical Edits*)
1. `vercel.json` — Kecualikan `/sw.js` dari rewrite SPA ke `/index.html`.
2. `src/main.tsx` (atau `src/app/app.tsx`) — Daftarkan root Service Worker (`/sw.js`) melalui `useSmartCacheSw`.
3. `src/types/bookmark.ts` & `src/services/bookmark-service.ts` — Tambah metadata opsional `assetKind`, `hlsUrl`, `smartCacheKey` agar video Markah (termasuk HLS) dapat diputar penuh dan terhubung ke SmartCache offline.
4. `src/pages/hasil-pencarian/aset/video-mini-card.tsx` — Integrasikan `videoPlaybackStore`, `videoLoadScheduler`, `smartCache` lookup/hydration trigger, dan sinkronisasi `currentTime` saat masuk/keluar Full View.
5. `src/pages/hasil-pencarian/aset/video-gallery.tsx` — Koordinasi `activePlayerId` & flush state saat membuka Full View.
6. `src/pages/hasil-pencarian/media-player/custom-video-player.tsx` — Baca snapshot `videoPlaybackStore` pada mount (`startPosition` untuk HLS & seek akurat pada MP4), flush `currentTime` + `wasPlaying` berkala & saat unmount/prev/next, serta picu SmartCache hydration.
7. `src/pages/hasil-pencarian/media-player/use-hls-player.ts` — Dukung opsi `startPosition`, `autoStartLoad`, serta pemutaran manifest lokal `/smartcache/v1/hls/...` selain `/api/hls/...`.
8. `src/pages/hasil-pencarian/aset/asset-info-modal.tsx` & `src/pages/pengaturan/` — Tampilkan status SmartCache aset dan tombol bersihkan cache video offline secara bersih sesuai desain CDNFREE.
9. `server/routes/stream-route.ts` & `server/routes/proxy-route.ts` — Gunakan `header-profile-store` pada permintaan `Range` agar tidak melakukan retry berulang per chunk, dan teruskan `Referer` opsional aman untuk aset Markah.

---

## Bagian 5 — Penanganan Edge Case Kritis

1. **Safari / WebKit `currentTime` Seek Sebelum Ready**:
   - Jika `video.currentTime = savedTime` dipanggil sebelum rentang seek tersedia, pasang guard listener satu kali pada `loadedmetadata` / `canplay` / `durationchange` selama `pendingResumeTimeRef !== null`, lalu verifikasi rentang `video.seekable`.
2. **HLS Token Kedaluwarsa Saat Offline**:
   - Karena SmartCache menulis ulang manifest varian ke `/smartcache/v1/hls/<key>/index.m3u8` dan menyimpan segmen ke key kanonik lokal tanpa query token kedaluwarsa, pemutaran offline di kemudian hari tetap berjalan mulus tanpa menyentuh server.
3. **Konflik dengan Scramjet Service Worker (`/p/`)**:
   - Scope `/sw.js` hanya menangani permintaan app shell dan media SmartCache; semua path `/p/*`, `/api/proxy*`, dan `/api/inspect*` langsung di-`return` (bypass ke jaringan / ditangani oleh `/proxy/sw.js` di scope `/p/`).
4. **Video Eksternal Berukuran Raksasa (> 512 MB) atau Stream Live HLS**:
   - Untuk `#EXT-X-PLAYLIST-TYPE` tanpa `#EXT-X-ENDLIST` (live stream), **jangan** lakukan full hydration.
   - Untuk file melebihi batas per-file SmartCache (mis. `> 512 MB`) atau sisa kuota browser tidak mencukupi, SmartCache otomatis melewatkan caching file utuh tanpa mengganggu pemutaran streaming normal.
5. **Kegagalan OPFS di Mode Incognito / Private Browsing**:
   - Fallback otomatis ke `CacheStorage`; jika keduanya ditolak (kuota 0 / Private mode ketat), tetap berjalan normal dalam mode streaming online tanpa error UI yang memblokir video.
6. **File MP4 dengan `moov` Atom di Akhir File**:
   - Ketika `CustomVideoPlayer` / `VideoMiniCard` membuka stream via `/api/assets/stream/...` yang sudah dioptimasi dengan `header-profile-store` dan `Accept-Ranges: bytes`, request byte-range untuk `moov` selesai dalam 1 hop tanpa retry header; setelah hydration selesai, seluruh file sudah ada di lokal untuk seek instan.

---

## Bagian 6 — Urutan Eksekusi & Rencana Pengujian (Saat Disetujui)

### Tahap Eksekusi Bertahap
1. **Fase A (Kontinuitas Playback & Fast Source)**: Implementasi `video-playback-store.ts`, `video-load-scheduler.ts`, `video-source-strategy.ts`, optimasi `stream-route.ts` (`header-profile-store`), serta pembaruan `VideoMiniCard`, `CustomVideoPlayer`, dan `use-hls-player.ts` (`startPosition` & `autoStartLoad`).
2. **Fase B (Storage & Hydration SmartCache)**: Implementasi `smart-cache-db.ts`, `smart-cache-storage.ts`, `smart-cache-hydrator.ts`, serta pembaruan `bookmark-service.ts` agar metadata Markah lengkap.
3. **Fase C (Root Service Worker & Range 206 Synthesizer)**: Implementasi `public/sw.js`, `use-smart-cache-sw.ts`, pembaruan `vercel.json`, dan integrasi kontrol kuota di Info Aset / Pengaturan.

### Rencana Pengujian & Kriteria Penerimaan (Acceptance Criteria)
- **Unit Tests (`node:test`)**:
  - `tests/unit/video-playback-store.test.ts`: Simpan/ambil/flush snapshot, kanonisasi key lintas halaman, batas entri.
  - `tests/unit/video-source-strategy.test.ts`: Pemilihan jalur `cache` → `hls` → `stream` → `direct`.
  - `tests/unit/smart-cache-hls-rewrite.test.ts`: Rewrite playlist HLS lokal kanonik & skip live stream tanpa `#EXT-X-ENDLIST`.
  - `tests/unit/sw-range-parser.test.ts`: Parsing header `Range` (`bytes=0-`, `bytes=100-999`, `bytes=-500`, invalid `416`) dan perhitungan `Content-Range`.
- **Integration & E2E Browser Verification (`playwright-cli`)**:
  1. **Uji Fast Load**: Render galeri video berisi ≥ 6 video + host butuh Referer → pastikan video klik aktif langsung mulai tanpa macet antrean dan tanpa retry direct yang berulang.
  2. **Uji Kontinuitas Card ↔ Full View**: Putar video di `VideoMiniCard` sampai detik `00:08` → klik Zoom → verifikasi `CustomVideoPlayer` melanjutkan dari `~00:08`; seek di Full View ke `00:22` lalu tutup Full View → verifikasi `VideoMiniCard` menampilkan posisi `~00:22`.
  3. **Uji SmartCache Offline**: Putar video MP4 dan HLS di Aset Manager/Markah hingga hydration selesai → aktifkan mode **Offline** di browser (`context.setOffline(true)`) → muat ulang `/markah` dan putar ulang kedua video tersebut → verifikasi status HTTP `200`/`206` dari Service Worker, video terputar lancar dan dapat di-seek penuh dari awal hingga akhir tanpa koneksi jaringan.
