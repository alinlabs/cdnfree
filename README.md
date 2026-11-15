# CDNFREE

**CDNFREE** adalah aplikasi web inspeksi tautan, penelusuran rantai pengalihan (*redirect chain*), pratinjau web terisolasi dual-mode (*Scramjet Engine* & *Mode Ringan*), ekstraksi aset mendalam (*deep asset scanner*), identifikasi host CDN, klasifikasi aturan daftar filter jaringan, pemutar media penuh, markah media lokal, serta pengunduhan & *streaming* aset publik tervalidasi.

CDNFREE dirancang agar pengguna dapat memeriksa tujuan akhir tautan, mendeteksi pola pelacakan atau pengalihan mencurigakan, meninjau seluruh aset statis maupun dinamis dari halaman (gambar, vektor SVG, video, audio, dokumen PDF, font, skrip, stylesheet), serta membuka halaman web secara terisolasi sebelum mengaksesnya secara langsung.

---

## Daftar Isi

- [1. Gambaran Umum & Arsitektur Sistem](#1-gambaran-umum--arsitektur-sistem)
- [2. Hirarki Struktur Web & Aplikasi](#2-hirarki-struktur-web--aplikasi)
  - [2.1 Hirarki Rute Halaman (Frontend SPA)](#21-hirarki-rute-halaman-frontend-spa)
  - [2.2 Hirarki Pohon Komponen Antarmuka (UI Component Tree)](#22-hirarki-pohon-komponen-antarmuka-ui-component-tree)
  - [2.3 Hirarki Endpoint Backend, Proxy, Streaming & WebSocket](#23-hirarki-endpoint-backend-proxy-streaming--websocket)
  - [2.4 Hirarki Lengkap Struktur Direktori & File Proyek](#24-hirarki-lengkap-struktur-direktori--file-proyek)
- [3. Fitur Utama & Mekanisme Kerja](#3-fitur-utama--mekanisme-kerja)
  - [3.1 Smart URL Parser & Konfigurasi Pencarian (Single vs Bulk)](#31-smart-url-parser--konfigurasi-pencarian-single-vs-bulk)
  - [3.2 Mesin Inspeksi Tautan & Deep Asset Scanner](#32-mesin-inspeksi-tautan--deep-asset-scanner)
  - [3.3 Tab Web Dual-Mode (Mode Engine & Mode Ringan)](#33-tab-web-dual-mode-mode-engine--mode-ringan)
  - [3.4 Asset Manager & Media Full View](#34-asset-manager--media-full-view)
  - [3.5 Markah Media, Riwayat Pencarian & Pengaturan](#35-markah-media-riwayat-pencarian--pengaturan)
- [4. Penyimpanan Lokal Browser (`localStorage` & `sessionStorage`)](#4-penyimpanan-lokal-browser-localstorage--sessionstorage)
- [5. Model Keamanan, Anti-SSRF & Batas Operasional](#5-model-keamanan-anti-ssrf--batas-operasional)
- [6. Sumber Daftar Filter & Atribusi](#6-sumber-daftar-filter--atribusi)
- [7. Tech Stack & Dependensi](#7-tech-stack--dependensi)
- [8. Instalasi, Perintah Pengembangan & Pengujian](#8-instalasi-perintah-pengembangan--pengujian)
- [9. Variabel Lingkungan & Deployment](#9-variabel-lingkungan--deployment)
- [10. Perilaku yang Didukung & Keterbatasan Diketahui](#10-perilaku-yang-didukung--keterbatasan-diketahui)

---

## 1. Gambaran Umum & Arsitektur Sistem

CDNFREE berjalan sebagai aplikasi **Full-Stack TypeScript** dengan server Express tunggal (`server.ts` + `server/app.ts`) yang melayani API inspeksi/proxy/streaming, *WebSocket Wisp transport*, mount statis *Scramjet Engine*, serta bundle React SPA (Vite middleware saat development, `dist/` statis saat produksi).

```text
+-----------------------------------------------------------------------------------+
|                                BROWSER PENGGUNA                                   |
|  React 19 SPA (/) (/search/*) (/riwayat-pencarian) (/markah) (/pengaturan)        |
|  +-- Penyimpanan Lokal: localStorage (riwayat, markah, pengaturan, config, cache) |
|  +-- Mode Engine Iframe (/p/#url) <---> Service Worker (/p/sw.js)                 |
|  |     Scramjet 2.x WASM + Controller + LibcurlClient                             |
|  +-- Mode Ringan Iframe (/api/proxy?u=...&sid=...)                                |
+------------------------------------+------------------------+---------------------+
                                     | HTTP/HTTPS             | WebSocket (/wisp/)
                                     v                        v
+-----------------------------------------------------------------------------------+
|                        SERVER EXPRESS CDNFREE (Port 3000)                         |
|  +-- /api/inspect & /api/inspect/:id  -> SSRF Guard + Redirect + Cheerio + Deep   |
|  +-- /api/proxy, /api/asset, /view    -> Mode Ringan Rewriter + CookieJar + SVG   |
|  +-- /api/assets/stream/:id/:assetId  -> HTTP 206 Range Streaming + Sanitasi SVG  |
|  +-- /api/assets/download             -> Unduhan Aset Terikat Sesi (Attachment)   |
|  +-- /api/captured?sid=...            -> Aset Runtime yang Ditangkap Proxy        |
|  +-- /api/filters/status & /refresh   -> FilterEngine v1.2.0 & Source Manager     |
|  +-- /wisp/ (Upgrade WS)              -> @mercuryworkshop/wisp-js (anti-private)  |
|  +-- /p/*                             -> File Statis Scramjet/Utils/Libcurl/SW    |
+------------------------------------+----------------------------------------------+
                                     | Validasi DNS A/AAAA + IP Pinning (No SSRF)
                                     v
                        +-------------------------+
                        |   HOST TUJUAN PUBLIK    |
                        +-------------------------+
```

---

## 2. Hirarki Struktur Web & Aplikasi

### 2.1 Hirarki Rute Halaman (Frontend SPA)

Seluruh rute dikelola oleh `src/app/routes.tsx` dan `src/utils/route-meta.ts` dengan *lazy loading* untuk halaman sekunder serta sinkronisasi judul dokumen (`DocumentTitleSync`).

```text
/                                    -> Beranda (Hero, Smart URL Input, Konfigurasi Pencarian)
├── /search                          -> Workspace Hasil Inspeksi (default: Tab Web)
│   ├── /search/web                  -> Tab Web (Mode Engine / Mode Ringan / Direct Asset)
│   ├── /search/detail               -> Tab Detail (Ringkasan, Redirect Chain, CDN, Temuan)
│   └── /search/aset                 -> Tab Aset (Asset Manager: Galeri Media, PDF, Tabel Sumber)
│       └── Query Parameters:
│           ├── ?ur=<encoded-url>    -> URL target inspeksi tunggal (clean URL param)
│           ├── ?bulk=<bulkId>       -> ID sesi inspeksi massal paralel (memaksa tab aset)
│           ├── ?id=<inspectionId>   -> ID sesi inspeksi spesifik (opsional)
│           ├── ?q=<keyword>         -> Kata kunci filter aset
│           ├── ?jenis=<kind>        -> Filter jenis aset (all|image|video|audio|document|script|stylesheet|font|other)
│           ├── ?fmt=<tokens>        -> Filter ekstensi/format (mis. jpg,png,webp,svg,mp4,pdf)
│           ├── ?status=<status>     -> Filter status filter/observasi
│           └── ?view=image|video&item=<id> -> Membuka overlay MediaFullView pada item tertentu
├── /hasil-pencarian/*               -> Alias rute kompatibilitas penuh untuk /search/*
│   ├── /hasil-pencarian             -> Alias /search
│   ├── /hasil-pencarian/web         -> Alias /search/web
│   ├── /hasil-pencarian/detail      -> Alias /search/detail
│   └── /hasil-pencarian/aset        -> Alias /search/aset
├── /riwayat-pencarian               -> Riwayat Pencarian lokal (cari, urutkan, hapus, pratinjau media)
│   └── ?entry=<id>&view=image|video&item=<id> -> MediaFullView langsung dari kartu riwayat
├── /markah                          -> Markah Media lokal (galeri gambar/vektor/video, impor/ekspor JSON)
│   └── ?view=image|video&item=<id>  -> MediaFullView langsung dari markah tersimpan
├── /pengaturan                      -> Pengaturan (Tema Dark/Light, Proteksi, Daftar Filter, Privasi)
└── *                                -> Halaman 404 (NotFoundPage)
```

> **Catatan Navigasi Global (`shouldShowGlobalNav`):**  
> Header global (`NavHeader`) dan footer penuh ditampilkan pada `/`, `/riwayat-pencarian`, `/markah`, dan `/pengaturan`. Pada rute workspace `/search/*` dan `/hasil-pencarian/*`, `NavHeader` disembunyikan dan digantikan oleh `ResultsHeader` terpadu (atau disembunyikan sepenuhnya pada mode *immersive fullscreen* Tab Web dengan tombol mengambang `FloatingBrandMenu`).

---

### 2.2 Hirarki Pohon Komponen Antarmuka (UI Component Tree)

```text
AppRoot (src/app/app.tsx)
├── SplashIntro (src/components/splash-intro.tsx) [tampil singkat saat boot awal]
└── BrowserRouter -> AppRoutes (src/app/routes.tsx)
    └── NavHeaderProvider (src/components/nav-header-context.tsx)
        └── Layout (src/components/layout.tsx)
            ├── [Rute Non-Hasil]
            │   ├── NavHeader (src/components/nav-header.tsx)
            │   │   ├── BrandWordmark (src/components/brand-wordmark.tsx)
            │   │   ├── Akses Cepat Beranda (Riwayat, Markah, Pengaturan)
            │   │   ├── MarkahHeaderSearch & MarkahHeaderToolbar (saat di /markah)
            │   │   └── HistoryHeaderSearch & HistoryHeaderToolbar (saat di /riwayat-pencarian)
            │   ├── <main> PageContainer
            │   │   ├── BerandaPage (src/pages/beranda/index.tsx)
            │   │   │   ├── TopProgressLine
            │   │   │   ├── HeroSection
            │   │   │   │   ├── AnimatedHeroTitle
            │   │   │   │   ├── UrlInput (single & multi-line smart input)
            │   │   │   │   ├── RecentHistory
            │   │   │   │   └── FeatureSummary
            │   │   │   └── SearchConfigModal (Single/Bulk, Target Tab, Filter Aset)
            │   │   ├── RiwayatPencarianPage (src/pages/riwayat-pencarian/index.tsx)
            │   │   │   ├── HistoryList -> Kartu riwayat + pratinjau media
            │   │   │   ├── MediaFullView (overlay pemutar gambar/video)
            │   │   │   └── ConfirmDialog
            │   │   ├── MarkahPage (src/pages/markah/index.tsx)
            │   │   │   ├── MediaGalleriesGrid (ImageGallery, VectorGallery, VideoGallery)
            │   │   │   ├── MediaFullView
            │   │   │   ├── MarkahImportModal
            │   │   │   └── ConfirmDialog
            │   │   ├── PengaturanPage (src/pages/pengaturan/index.tsx)
            │   │   │   ├── AppearanceSettingsSection (Dark / Light theme)
            │   │   │   ├── ProtectionSettingsSection (Filter, Peringatan, Downgrade, Bypass, Allowlist & Status Filter)
            │   │   │   └── PrivacySettingsSection (Simpan riwayat, Retensi, Hapus data)
            │   │   └── NotFoundPage (src/pages/not-found/index.tsx)
            │   └── Footer (src/components/footer.tsx)
            │
            └── [Rute Hasil: /search/* & /hasil-pencarian/*]
                └── HasilPencarianPage (src/pages/hasil-pencarian/shared/hasil-pencarian-page.tsx)
                    ├── ResultsHeader (tersembunyi saat Mode Immersive Web aktif)
                    │   ├── ResultsHeaderWebBar (Tab Web & Detail: input URL, muat ulang, tab switcher, buka aset/layar penuh)
                    │   └── ResultsHeaderAssetBar (Tab Aset: pencarian aset, AssetFilterPopover, segarkan, unduh semua)
                    ├── TopProgressLine
                    ├── TabWeb (src/pages/hasil-pencarian/web/tab-web.tsx)
                    │   ├── WebBypassToast
                    │   ├── WebDirectAssetView (untuk target non-HTML: gambar, PDF, video, audio, font, teks)
                    │   ├── Iframe Mode Engine (/p/#<target>) atau Mode Ringan (/api/proxy?u=...)
                    │   ├── Banner Status (X.com oEmbed notice, engine fallback notice, slow loading)
                    │   └── WebFallbackCard (jika URL tidak valid / tidak didukung)
                    ├── FloatingBrandMenu (tombol navigasi melayang saat mode web immersive penuh)
                    ├── TabDetail (src/pages/hasil-pencarian/detail/tab-detail.tsx)
                    │   ├── DetailOverviewSection
                    │   ├── RedirectChain
                    │   ├── CdnHostsSection
                    │   ├── ReviewFindingsSection
                    │   ├── BlockingSummarySection
                    │   ├── SuspiciousLinks
                    │   └── AnalysisLimitationsSection
                    ├── TabAset (src/pages/hasil-pencarian/aset/tab-aset.tsx)
                    │   ├── MediaGalleriesGrid
                    │   │   ├── ImageGallery -> AssetCardActions / AssetCardMenu / AssetInfoModal
                    │   │   ├── VectorGallery (SVG tersanitasi berlatar papan catur)
                    │   │   └── VideoGallery -> VideoMiniCard
                    │   ├── AudioGallery
                    │   ├── DocumentGallery -> PdfPreview (pdfjs-dist)
                    │   ├── ResourceTable (Skrip, Stylesheet, Font, Lainnya)
                    │   │   ├── TextAssetModal (pratinjau teks/kode hingga 64 KB)
                    │   │   └── ResourcePreviewModal (pratinjau FontFace & sumber daya lain)
                    │   └── MediaFullView (src/pages/hasil-pencarian/media-player/media-full-view.tsx)
                    │       ├── MediaPlayerHeader (navigasi item, markah, salin URL, unduh, tutup)
                    │       ├── CustomImageViewer (zoom, pan, reset, keyboard)
                    │       └── CustomVideoPlayer -> VideoPlayerControls & VideoSpeedControl
                    └── Footer
```

---

### 2.3 Hirarki Endpoint Backend, Proxy, Streaming & WebSocket

Didefinisikan di `server.ts`, `server/app.ts`, `server/wisp.ts`, dan `server/routes/*`:

```text
HTTP / Express Server (0.0.0.0:3000)
├── GET  /api/health                              -> Status kesehatan server & versi
├── POST /api/inspect                             -> Inspeksi URL baru (redirect, HTML, aset, filter, CDN)
├── GET  /api/inspect/:id                         -> Ambil ulang hasil inspeksi aktif dari InspectionStore
├── POST /api/assets/download                     -> Unduh aset terikat { inspectionId, resourceId } (attachment)
├── GET|HEAD /api/assets/stream/:inspectionId/:assetId -> Streaming media aman + HTTP 206 Range + sanitasi SVG
├── ALL  /api/proxy                               -> Reverse proxy Mode Ringan (GET/HEAD/POST/PUT/PATCH, ?debug=1)
├── GET|HEAD /api/asset                           -> Proksi aset same-origin (CSS/JS/M3U8 rewrite, SVG sanitize, Range 206)
├── GET  /api/captured                            -> Daftar aset runtime yang tertangkap oleh sesi proxy (?sid=...)
├── GET  /view                                    -> Viewer shortcut (?u=...&sid=...) -> 302 redirect ke /api/proxy
├── GET  /api/filters/status                      -> Status daftar filter (baseline & remote sources)
├── POST /api/filters/refresh                     -> Sinkronisasi manual daftar filter jarak jauh (If-None-Match/IMS)
│
├── Static Mounts (Mode Engine Scramjet)
│   ├── /p/scram/*                                -> @mercuryworkshop/scramjet (WASM & runtime)
│   ├── /p/controller/*                           -> @mercuryworkshop/scramjet-controller
│   ├── /p/utils/*                                -> @mercuryworkshop/scramjet-utils
│   ├── /p/libcurl/*                              -> @mercuryworkshop/libcurl-transport
│   └── /p/*                                      -> public/proxy/ (index.html & sw.js dengan Service-Worker-Allowed: /p/)
│
├── WebSocket Upgrade
│   └── WS /wisp/                                 -> Transport Wisp (@mercuryworkshop/wisp-js, blokir IP privat/loopback)
│
└── Frontend Delivery
    ├── [Dev]  vite.middlewares                   -> SPA Vite (HMR dinonaktifkan aman bila DISABLE_HMR=true)
    └── [Prod] dist/                              -> File statis hasil build + fallback SPA index.html
```

---

### 2.4 Hirarki Lengkap Struktur Direktori & File Proyek

Berikut pemetaan seluruh direktori dan file yang ada di repositori ini:

```text
cdnfree/
├── .env.example                            # Template variabel lingkungan (GEMINI_API_KEY, APP_URL)
├── .gitignore                              # Aturan pengecualian Git
├── index.html                              # Entry HTML + meta OpenGraph/SEO + inline script anti-FOUC tema
├── metadata.json                           # Metadata aplikasi (nama, deskripsi, kapabilitas)
├── package.json                            # Skrip npm & daftar seluruh dependensi proyek
├── tsconfig.json                           # Konfigurasi TypeScript (ES2022, bundler resolution, path @/*)
├── vite.config.ts                          # Konfigurasi Vite (React, Tailwind v4, manualChunks, DISABLE_HMR)
├── vercel.json                             # Konfigurasi deployment Vercel (rewrites /api, /view, SPA, header keamanan)
├── server.ts                               # Entrypoint server Node.js/Express + Vite dev middleware + Wisp upgrade
├── bun.lock                                # Lockfile dependensi
├── README.md                               # Dokumentasi lengkap aplikasi (file ini)
├── mekanisme-web.md                        # Dokumentasi teknis mendalam Dual Mode Web (Engine vs Ringan)
├── IMPLEMENTATION-STATUS.md                # Catatan status implementasi & verifikasi bertahap
├── QA-CHECKLIST.md                         # Daftar periksa QA keamanan, fungsional & responsivitas
│
├── api/
│   └── index.ts                            # Handler serverless Vercel yang mengekspor createApiApp()
│
├── public/
│   ├── favicon.svg                         # Ikon tab browser SVG
│   ├── logo.webp                           # Logo resmi CDNFREE (juga dipakai sebagai media markah bawaan)
│   ├── robots.txt                          # Kebijakan crawler mesin pencari
│   ├── assets/aistudio/                    # Aset gambar statis tambahan
│   └── proxy/                              # Host frame & Service Worker khusus Mode Engine Scramjet
│       ├── index.html                      # Bootstrap Scramjet Controller, LibcurlClient, FingerprintMask & AssetObserver
│       └── sw.js                           # Service Worker `/p/sw.js` untuk merutekan request frame `/p/sj/*`
│
├── scripts/
│   ├── check-file-length.cjs               # Skrip audit batas maksimum panjang file sumber (<= 600 baris)
│   └── validate-filter-sources.cjs         # Skrip validasi header & sintaks `baseline-filters.txt`
│
├── fixtures/
│   └── asset-matrix.html                   # Fixture HTML matriks aset untuk pengujian ekstraksi
│
├── server/                                 # Kode backend Express, keamanan, inspeksi & proxy
│   ├── app.ts                              # Factory createApiApp(): COOP/COEP, CORS/CSRF guard, router mounting
│   ├── wisp.ts                             # Konfigurasi server WebSocket `/wisp/` & hardening IP
│   ├── data/
│   │   └── baseline-filters.txt            # Daftar filter jaringan bawaan luring (44 aturan terverifikasi)
│   ├── types/
│   │   ├── server.ts                       # Tipe domain server & InspectionPolicyError
│   │   └── wisp-js.d.ts                    # Deklarasi tipe TypeScript untuk @mercuryworkshop/wisp-js
│   ├── routes/
│   │   ├── health-route.ts                 # GET /api/health
│   │   ├── inspect-route.ts                # POST /api/inspect & GET /api/inspect/:id
│   │   ├── download-route.ts               # POST /api/assets/download
│   │   ├── stream-route.ts                 # GET|HEAD /api/assets/stream/:inspectionId/:assetId
│   │   ├── proxy-route.ts                  # ALL /api/proxy, GET|HEAD /api/asset, GET /api/captured, GET /view
│   │   └── filters-route.ts                # GET /api/filters/status & POST /api/filters/refresh
│   ├── security/
│   │   ├── ip-policy.ts                    # Validasi rentang IPv4/IPv6 privat, loopback, CGNAT & metadata cloud
│   │   ├── request-limits.ts               # Konstanta limit, MIME allowlist/denylist, RateLimiter & ConcurrencyLimiter
│   │   └── response-sanitizer.ts           # Penyaringan token sensitif URL pada log server
│   └── services/
│       ├── url-policy.ts                   # Validasi skema, resolusi DNS A/AAAA & pencegahan DNS rebinding
│       ├── safe-fetch.ts                   # Pengambil HTTP/HTTPS manual dengan IP pinning & batas dekompresi
│       ├── redirect-inspector.ts           # Penelusuran hop-by-hop redirect (maks 8 hop) + orkestrasi inspeksi
│       ├── client-redirect.ts              # Deteksi meta-refresh & client-side redirect HTML
│       ├── html-extractor.ts               # Parser statis cheerio (metadata, tautan, aset, ringkasan CDN)
│       ├── html-link-analyzer.ts           # Klasifikasi tautan mencurigakan, shortener & parameter pelacak
│       ├── asset-classify.ts               # Normalisasi MIME & klasifikasi jenis aset sisi server
│       ├── asset-extract.ts                # Ekstraksi URL aset dari atribut HTML, srcset & manifest MPD
│       ├── asset-probe.ts                  # Verifikasi ketersediaan aset & ukuran via HEAD/Range probe
│       ├── asset-resolve.ts                # Resolusi URL relatif & deduplikasi kandidat aset
│       ├── asset-rules.ts                  # Aturan pencocokan & pemeringkatan aset
│       ├── asset-pipeline-bridge.ts        # Penghubung antara ekstraksi statis, deep scanner & hasil inspeksi
│       ├── deep-asset-scanner.ts           # Pemindai aset sekunder paralel (CSS, JS entry, manifest, m3u8, iframe)
│       ├── deep-asset-extractor.ts         # Ekstraktor URL aset dari isi CSS, JS inline, M3U8 & manifest JSON
│       ├── asset-downloader.ts             # Validasi ulang & streaming unduhan aset terikat sesi inspeksi
│       ├── filter-engine.ts                # Mesin pencocokan aturan jaringan v1.2.0 (`||domain^`, `@@`, `$third-party`)
│       ├── filter-source-fetch.ts          # Pengambilan aman sumber filter jarak jauh (If-None-Match/IMS, SHA-256)
│       ├── filter-source-manager.ts        # Pengelola siklus hidup & fallback daftar filter di memori
│       ├── public-suffix.ts                # Daftar akhiran domain multi-label untuk deteksi third-party
│       ├── inspection-store.ts             # Penyimpanan hasil inspeksi di memori (TTL 30 menit, maks 100 entri)
│       └── proxy/                          # Sub-modul Mode Ringan Proxy
│           ├── safe-proxy-fetch.ts         # Fetch proxy aman dengan penerusan header & cookie jar
│           ├── proxy-request-helpers.ts    # Parsing method/body, penerusan header aman & payload ?debug=1
│           ├── asset-route-helpers.ts      # Helper mime, passthrough header, buffering & friendly error HTML
│           ├── cookie-jar.ts               # SessionCookieJarStore efemeral per (sid, host) di memori
│           ├── frame.ts                    # Pengaturan header frameable & CSP frame-ancestors
│           ├── rewrite.ts                  # Penulisan ulang HTML, CSS, ESM JS & playlist M3U8 ke proxy/asset
│           ├── shim.ts                     # Runtime shim injeksi klien untuk Mode Ringan (fetch/XHR/history/DOM)
│           ├── shim-anti-jack.ts           # Pelindung anti-clickjacking, anti-frame-busting & popup netralisasi
│           ├── stream-response.ts          # Pemotong byte-range (HTTP 206) & piping stream upstream aman
│           ├── svg-sanitizer.ts            # Sanitasi XML SVG (menghapus <script>, event handler, URI berbahaya)
│           ├── captured-store.ts           # Penyimpanan aset runtime yang tertangkap saat sesi proxy berjalan
│           └── urlcodec.ts                 # Enkode/dekode base64url & sanitasi parameter URL proxy
│
├── src/                                    # Kode frontend React 19 + TypeScript + Tailwind CSS v4
│   ├── main.tsx                            # Mount React ke #root & impor font Inter Variable
│   ├── App.tsx                             # Re-ekspor AppRoot
│   ├── index.css                           # Variabel CSS tema light/dark, Tailwind v4 & animasi utilitas
│   ├── assets/
│   │   └── into-landscape.mp4              # Video demo bawaan untuk Markah Media
│   ├── app/
│   │   ├── app.tsx                         # AppRoot (sinkronisasi tema + SplashIntro + BrowserRouter)
│   │   └── routes.tsx                      # Definisi seluruh rute SPA & lazy loading halaman
│   ├── components/                         # Komponen UI bersama lintas halaman
│   │   ├── brand-wordmark.tsx              # Logo & wordmark CDNFREE
│   │   ├── confirm-dialog.tsx              # Dialog konfirmasi aksi destruktif & buka tautan eksternal
│   │   ├── drawer.tsx                      # Panel geser aksesibel dengan focus trap
│   │   ├── empty-state.tsx                 # Tampilan state kosong standar
│   │   ├── error-state.tsx                 # Tampilan pesan error & tombol coba lagi
│   │   ├── external-link-action.tsx        # Tombol buka situs eksternal dengan konfirmasi keamanan
│   │   ├── footer.tsx                      # Footer aplikasi
│   │   ├── layout.tsx                      # Pembungkus tata letak utama (global nav vs workspace hasil)
│   │   ├── loading-state.tsx               # Skeleton / indikator pemuatan
│   │   ├── modal.tsx                       # Dialog modal aksesibel dengan dukungan safe-area & Esc
│   │   ├── nav-header.tsx                  # Header navigasi global & toolbar sub-halaman
│   │   ├── nav-header-context.tsx          # Context kontrol toolbar dinamis (Markah & Riwayat)
│   │   ├── page-container.tsx              # Pembatas lebar responsif maks 1440px
│   │   ├── pdf-preview.tsx                 # Penampil PDF interaktif multi-halaman berbasis pdfjs-dist
│   │   ├── setting-switch.tsx              # Komponen sakelar aksesibel (role="switch")
│   │   ├── splash-intro.tsx                # Layar pembuka animasi singkat
│   │   ├── text-asset-modal.tsx            # Modal pratinjau isi berkas teks/kode/CSS/JSON (maks 64 KB)
│   │   ├── top-progress-line.tsx           # Garis progres horizontal di atas viewport
│   │   └── url-input.tsx                   # Input URL pintar (dukungan single-line & multi-line paste)
│   ├── hooks/                              # Custom React Hooks
│   │   ├── default-bookmarks.ts            # Generator entri markah media bawaan
│   │   ├── use-bookmarks.ts                # Manajemen state markah lokal & sinkronisasi event
│   │   ├── use-engine-sw.ts                # Registrasi & pemantauan status Service Worker `/p/sw.js`
│   │   ├── use-history.ts                  # Manajemen riwayat lokal & retensi otomatis
│   │   ├── use-in-view.ts                  # Deteksi visibilitas elemen (IntersectionObserver)
│   │   ├── use-inspection.ts               # Pengiriman & pemuatan hasil inspeksi dari API
│   │   ├── use-resilient-image.ts          # Pemuatan gambar tangguh (fallback proxy/stream otomatis)
│   │   └── use-settings.ts                 # Manajemen state pengaturan & sinkronisasi tema
│   ├── pages/
│   │   ├── beranda/                        # Halaman `/`
│   │   │   ├── index.tsx                   # Orkestrasi Beranda, auto-bulk & navigasi hasil
│   │   │   ├── hero-section.tsx            # Bagian hero utama dengan UrlInput & tombol konfigurasi
│   │   │   ├── animated-hero-title.tsx     # Animasi judul hero
│   │   │   ├── search-config-modal.tsx     # Modal pengaturan mode link, tab tujuan & filter awal aset
│   │   │   ├── recent-history.tsx          # Daftar riwayat cepat terbaru di Beranda
│   │   │   └── feature-summary.tsx         # Ringkasan kapabilitas CDNFREE
│   │   ├── hasil-pencarian/                # Workspace `/search/*` & `/hasil-pencarian/*`
│   │   │   ├── index.ts                    # Barrel export HasilPencarianPage
│   │   │   ├── shared/                     # Logika bersama workspace hasil
│   │   │   │   ├── hasil-pencarian-page.tsx # Shell workspace 3 tab, bulk mode & immersive web
│   │   │   │   ├── results-header.tsx      # Header terpadu workspace hasil
│   │   │   │   ├── results-header-web-bar.tsx   # Toolbar khusus tab Web & Detail
│   │   │   │   ├── results-header-asset-bar.tsx # Toolbar pencarian, filter & unduh massal tab Aset
│   │   │   │   ├── results-navigation.ts   # Pembangun & parser rute tab + parameter query
│   │   │   │   ├── workspace-route-state.ts # Ekstraksi state rute & sinkronisasi URL ?ur=
│   │   │   │   ├── ur-session-cache.ts     # Cache sesi browser untuk ?ur= agar reload cepat
│   │   │   │   ├── inspection-actions.ts   # Helper aksi salin, muat ulang & buka eksternal
│   │   │   │   ├── use-inspection-workspace.ts # State utama inspeksi, re-inspect & pengumpulan aset
│   │   │   │   ├── use-bulk-workspace.ts   # State & agregasi hasil multi-URL (bulk mode)
│   │   │   │   ├── use-live-asset-collection.ts # Penggabungan aset statis + proxy captured + engine
│   │   │   │   ├── use-resource-downloads.ts # Antrean & status unduhan per aset
│   │   │   │   └── use-copy-feedback.ts    # Feedback visual penyalinan URL
│   │   │   ├── web/                        # Tab Web
│   │   │   │   ├── tab-web.tsx             # Orkestrasi Mode Engine, Mode Ringan & Direct Asset
│   │   │   │   ├── use-web-frame.ts        # Komunikasi postMessage iframe, auto-fallback & tinggi frame
│   │   │   │   ├── collect-frame-sources.ts # Ekstraksi aset DOM dari iframe Mode Ringan
│   │   │   │   ├── frame-collection-utils.ts # Utilitas pengumpulan sumber daya frame
│   │   │   │   ├── floating-brand-menu.tsx # Menu melayang saat mode web layar penuh (immersive)
│   │   │   │   ├── web-frame-menu.tsx      # Opsi & navigasi cepat dalam frame
│   │   │   │   ├── web-direct-asset-view.tsx # Tampilan langsung berkas non-HTML (SVG, PDF, video, teks)
│   │   │   │   ├── web-fallback-card.tsx   # Kartu fallback jika pratinjau diblokir/tidak didukung
│   │   │   │   └── web-bypass-toast.tsx    # Notifikasi saat navigasi keluar situs dicegat
│   │   │   ├── detail/                     # Tab Detail
│   │   │   │   ├── tab-detail.tsx          # Tata letak laporan lengkap inspeksi
│   │   │   │   ├── detail-overview-section.tsx # Ringkasan URL akhir, status HTTP, MIME & metadata
│   │   │   │   ├── redirect-chain.tsx      # Visualisasi hop-by-hop rantai pengalihan
│   │   │   │   ├── cdn-hosts-section.tsx   # Daftar host & penyedia CDN terdeteksi
│   │   │   │   ├── review-findings-section.tsx # Daftar temuan tautan & aset perlu ditinjau
│   │   │   │   ├── blocking-summary-section.tsx # Statistik pencocokan aturan filter jaringan
│   │   │   │   ├── suspicious-links.tsx    # Daftar tautan statis mencurigakan / pelacak / shortener
│   │   │   │   ├── analysis-limitations-section.tsx # Pengungkapan transparansi & batasan analisis
│   │   │   │   └── detail-labels.ts        # Pemetaan label & status ke Bahasa Indonesia
│   │   │   ├── aset/                       # Tab Aset (Asset Manager)
│   │   │   │   ├── tab-aset.tsx            # Kontainer galeri & tabel aset dengan paginasi
│   │   │   │   ├── use-asset-manager.ts    # Filter kata kunci, jenis, format, status & batch download
│   │   │   │   ├── asset-filters.ts        # Logika filter murni & resolver URL parameter FullView
│   │   │   │   ├── asset-filter-popover.tsx # Popover filter jenis, format (JPG/SVG/MP4/PDF) & status
│   │   │   │   ├── media-galleries-grid.tsx # Pemisah & grid terpadu galeri gambar, vektor & video
│   │   │   │   ├── image-gallery.tsx       # Galeri foto raster
│   │   │   │   ├── vector-gallery.tsx      # Galeri SVG tersanitasi dengan latar transparan
│   │   │   │   ├── video-gallery.tsx       # Galeri video
│   │   │   │   ├── video-mini-card.tsx     # Kartu pratinjau video tanpa autoplay
│   │   │   │   ├── audio-gallery.tsx       # Galeri pemutar audio inline (<audio controls>)
│   │   │   │   ├── document-gallery.tsx    # Galeri dokumen PDF dengan thumbnail halaman 1
│   │   │   │   ├── resource-table.tsx      # Tabel skrip, stylesheet, font & sumber lainnya
│   │   │   │   ├── resource-preview-modal.tsx # Modal pratinjau FontFace & aset non-gambar
│   │   │   │   ├── asset-card-actions.tsx  # Aksi cepat kartu media (Full View, markah, salin, unduh)
│   │   │   │   ├── asset-card-menu.tsx     # Menu konteks kartu aset
│   │   │   │   └── asset-info-modal.tsx    # Modal rincian metadata & sumber aset
│   │   │   └── media-player/               # Penampil & Pemutar Media Layar Penuh
│   │   │       ├── index.ts                # Barrel export MediaFullView
│   │   │       ├── media-full-view.tsx     # Kontainer modal layar penuh dengan auto-hide chrome
│   │   │       ├── media-player-header.tsx # Bilah atas (judul, counter, markah, salin, unduh, tutup)
│   │   │       ├── custom-image-viewer.tsx # Penampil gambar dengan zoom & geser (pan)
│   │   │       ├── custom-video-player.tsx # Pemutar video kustom berbasis HTML5 + Range streaming
│   │   │       ├── video-player-controls.tsx # Kontrol play/pause, seek bar, volume, fullscreen
│   │   │       ├── video-speed-control.tsx # Pemilih kecepatan putar (0.5x – 2x)
│   │   │       ├── media-player-error.tsx  # Tampilan error pemuatan media + aksi buka eksternal
│   │   │       ├── media-fullscreen.ts     # Helper API Fullscreen lintas browser
│   │   │       ├── media-player-utils.ts   # Utilitas navigasi indeks & pemformatan metadata
│   │   │       └── use-media-stage.ts      # State stage media & deteksi error
│   │   ├── markah/                         # Halaman `/markah`
│   │   │   ├── index.tsx                   # Galeri Markah Media + integrasi MediaFullView
│   │   │   ├── markah-toolbar.tsx          # Filter semua/gambar/video, cari, ekspor, impor & hapus
│   │   │   └── markah-import-modal.tsx     # Modal impor berkas atau teks JSON markah
│   │   ├── riwayat-pencarian/              # Halaman `/riwayat-pencarian`
│   │   │   ├── index.tsx                   # Daftar riwayat + integrasi MediaFullView
│   │   │   ├── history-toolbar.tsx         # Pencarian, pengurutan & hapus seluruh riwayat
│   │   │   └── history-list.tsx            # Daftar kartu riwayat dengan strip pratinjau media
│   │   ├── pengaturan/                     # Halaman `/pengaturan`
│   │   │   ├── index.tsx                   # Shell halaman Pengaturan
│   │   │   ├── appearance-settings.tsx     # Pilihan tema Gelap / Terang
│   │   │   ├── protection-settings.tsx     # Sakelar proteksi, allowlist host & manajemen daftar filter
│   │   │   └── privacy-settings.tsx        # Kontrol simpan riwayat, retensi (7/30/90/0 hari) & hapus data
│   │   └── not-found/
│   │       └── index.tsx                   # Halaman 404 dengan tautan kembali ke Beranda
│   ├── services/                           # Klien API & pengelola penyimpanan browser
│   │   ├── inspection-service.ts           # Klien POST /api/inspect & GET /api/inspect/:id (validasi zod)
│   │   ├── bulk-inspection-store.ts        # Orkestrator antrean bulk paralel (konkurensi 6, retry otomatis)
│   │   ├── download-service.ts             # Pengunduh blob via POST /api/assets/download
│   │   ├── bookmark-service.ts             # CRUD, normalisasi, impor/ekspor JSON & migrasi markah lokal
│   │   ├── history-service.ts              # CRUD, pemangkasan retensi & penyamaran token riwayat
│   │   └── settings-service.ts             # CRUD pengaturan, status/refresh filter API & normalisasi allowlist
│   ├── types/                              # Definisi tipe TypeScript frontend
│   │   ├── inspection.ts
│   │   ├── bookmark.ts
│   │   ├── history.ts
│   │   └── settings.ts
│   └── utils/                              # Fungsi utilitas murni & kebijakan klien
│       ├── smart-url-parser.ts             # Ekstraktor URL cerdas dari teks berantakan / terputus spasi
│       ├── smart-url-tokens.ts             # Tokenizer & aturan TLD/ekstensi untuk parser URL
│       ├── normalize-url.ts                # Normalisasi URL & deteksi host terlarang sisi klien
│       ├── clean-url.ts                    # Enkode/dekode parameter query `?ur=`
│       ├── redact-url.ts                   # Penyamaran parameter sensitif (`token`, `key`, `secret`, dll.)
│       ├── safe-external-url.ts            # Validasi navigasi keluar & kelayakan unduhan aset
│       ├── search-config.ts                # Barrel & helper resolusi auto-bulk
│       ├── search-config-core.ts           # Preset format aset & tipe konfigurasi pencarian
│       ├── search-config-storage.ts        # Persistensi konfigurasi pencarian di localStorage
│       ├── web-view-policy.ts              # Resolusi Mode Engine vs Ringan, ambang auto-fallback & X.com oEmbed
│       ├── asset-explorer.ts               # Pengelompokan galeri, deduplikasi kanonis & label format
│       ├── asset-preview-policy.ts         # Kebijakan keamanan pratinjau gambar/video
│       ├── classify-resource.ts            # Klasifikasi jenis aset & aturan deteksi penyedia CDN/shortener
│       ├── inspection-details.ts           # Selektor turunan untuk Tab Detail
│       ├── proxy-url.ts                    # Pembangun URL `/api/asset`, `/api/proxy` & `/api/assets/stream`
│       ├── local-media.ts                  # Penanganan media bawaan lokal (`logo.webp`, `into-landscape.mp4`)
│       ├── media-probe.ts                  # Pemeriksaan dimensi/durasi media di browser
│       ├── frame-context.ts                # Deteksi apakah aplikasi berjalan di dalam iframe bersarang
│       ├── route-meta.ts                   # Peta judul halaman & helper rute aktif
│       ├── theme.ts                        # Penerapan kelas `.dark` & `meta[name="theme-color"]`
│       ├── focus-trap.ts                   # Pengunci fokus keyboard untuk modal/drawer aksesibel
│       ├── format-bytes.ts                 # Pemformat ukuran byte yang mudah dibaca
│       └── format-date.ts                  # Pemformat tanggal lokal Bahasa Indonesia (`id-ID`)
│
└── tests/                                  # Suite pengujian otomatis (`tsx --test`)
    ├── fixtures/
    │   └── html-pages.ts                   # Fixture halaman HTML untuk pengujian
    ├── unit/                               # 27 file unit test (parser URL, filter engine, IP policy, dll.)
    └── integration/                        # 8 file integration test (API inspect, proxy, streaming, download, filters)
```

---

## 3. Fitur Utama & Mekanisme Kerja

### 3.1 Smart URL Parser & Konfigurasi Pencarian (Single vs Bulk)

- **Smart URL Parser (`src/utils/smart-url-parser.ts`):** Mampu memisahkan dan memperbaiki URL yang tertempel dalam paragraf teks, dipisahkan spasi yang terputus pada ekstensi/path (mis. `contoh .com / video .mp4`), atau banyak skema yang saling menempel.
- **Deteksi Bulk Otomatis (`AUTO_BULK_URL_THRESHOLD`):** Saat pengguna menempelkan beberapa URL sekaligus pada input Beranda, aplikasi otomatis beralih ke mode **Bulk Link** dan membuka workspace **Asset Manager** secara paralel (maksimal **6 koneksi paralel** dengan *retry* otomatis untuk error jaringan transien via `bulk-inspection-store.ts`).
- **Search Config Modal (`src/pages/beranda/search-config-modal.tsx`):** Memungkinkan pengguna memilih:
  - Mode tautan: `Single Link` atau `Bulk Link`.
  - Tab tujuan default (khusus single): `Web`, `Detail`, atau `Aset` (bisa memilih satu atau lebih tab aktif).
  - Pre-filter aset: Jenis aset (`all`, `image`, `video`, `audio`, `document`, `script`, `stylesheet`, `font`, `other`), format preset (`JPG`, `PNG`, `WEBP`, `SVG`, `GIF`, `AVIF`, `MP4`, `WEBM`, `PDF`, `MP3`, `CSS`, `JS`, `WOFF2`), dan kata kunci pencarian aset.

### 3.2 Mesin Inspeksi Tautan & Deep Asset Scanner

1. **`POST /api/inspect`:** Memvalidasi skema & IP target, melacak pengalihan HTTP secara manual hingga **8 hop** (serta mendeteksi *client-side redirect* seperti `<meta http-equiv="refresh">`), mencatat penurunan protokol (`HTTPS -> HTTP`), serta menandai URL pemendek (*shortener*) dan parameter pelacak (*UTM*, `fbclid`, `gclid`, dll.).
2. **Ekstraksi HTML Statis (`html-extractor.ts`):** Mengurai HTML memakai `cheerio` tanpa mengeksekusi JavaScript. Mengekstrak judul, deskripsi, tautan eksternal, referensi media, dan meringkas penyedia CDN yang terdeteksi.
3. **Deep Asset Scanner (`deep-asset-scanner.ts` & `deep-asset-extractor.ts`):** Dengan anggaran waktu terukur (`6,5 detik`, konkurensi `6`), memindai secara sekunder isi CSS eksternal (hingga 15 stylesheet + `@import`), entry JS (hingga 4), manifest web (hingga 3), iframe (hingga 5), dan playlist HLS/DASH (`.m3u8` / `.mpd`), serta melakukan `HEAD` probe (hingga 12 aset) untuk memverifikasi MIME dan ukuran file.

### 3.3 Tab Web Dual-Mode (Mode Engine & Mode Ringan)

Penjelasan arsitektur lengkap tersedia pada [`mekanisme-web.md`](./mekanisme-web.md). Ringkasnya:

- **Mode Engine (Default untuk HTML — `/p/#<target>`):**
  - Menggunakan **Scramjet 2.x + Wisp WebSocket (`/wisp/`) + Libcurl Transport** yang berjalan melalui parent Service Worker `/p/sw.js`.
  - Memasang header `Cross-Origin-Opener-Policy: same-origin` dan `Cross-Origin-Embedder-Policy: credentialless` pada `/search`, `/hasil-pencarian`, dan `/p/`.
  - Dilengkapi plugin `HttpCachePlugin`, `UrlWatcherPlugin`, `CatchEscapedLinksPlugin`, `FingerprintMaskPlugin` (menyamarkan global `$scramjet` ke `__cf_*`), dan `AssetObserverPlugin` (mengirim aset media yang terdeteksi saat browsing ke Tab Aset).
  - **Auto-Fallback:** Jika sebuah host gagal dimuat di Mode Engine sebanyak **2 kali** (`ENGINE_FAILURE_THRESHOLD = 2`), host dicatat di `cdnfree:engine-fallback:v1` dan otomatis beralih ke **Mode Ringan**.
- **Mode Ringan (`/api/proxy` & `/api/asset`):**
  - Reverse proxy same-origin berbasis `cheerio` yang menulis ulang dokumen HTML, CSS, ES Module JS, dan M3U8, menghapus header pemblokir frame (`X-Frame-Options`, `CSP`), menyuntikkan `shim.ts` + `shim-anti-jack.ts`, serta mengelola *Session Cookie Jar* efemeral di memori per `(sid, host)`.
  - Mendukung endpoint diagnostik `?debug=1` dan *retry* otomatis tanpa header `Referer` jika CDN menolak `401/403/406`.
- **Direct Asset View (`WebDirectAssetView`):**
  - Jika URL target mengarah langsung ke file non-HTML (gambar, SVG, PDF, video, audio, font, JSON/CSS/JS/teks), tab Web langsung menampilkan pratinjau aman via `/api/asset`.

### 3.4 Asset Manager & Media Full View

- **Tab Aset (`TabAset`):** Menggabungkan aset dari ekstraksi statis, *deep scanner*, aset runtime yang tertangkap proxy (`GET /api/captured?sid=...`), dan aset yang diamati *Mode Engine*.
- **Galeri Terkategori:**
  - **ImageGallery:** Foto raster dengan pemuatan tangguh (`use-resilient-image.ts`).
  - **VectorGallery:** Thumbnail SVG tersanitasi (`svg-sanitizer.ts`) di atas latar kotak-kotak transparan.
  - **VideoGallery:** Kartu video tanpa *autoplay* (`preload="none"`) untuk menghemat bandwidth.
  - **AudioGallery:** Pemutar audio HTML5 inline (`<audio controls>`).
  - **DocumentGallery:** Kartu PDF dengan thumbnail halaman pertama yang dirender lewat `pdfjs-dist` `<canvas>` + penampil multi-halaman interaktif (`PdfPreview`).
  - **ResourceTable:** Daftar terpaginasi (25 per halaman) untuk stylesheet, skrip, font, dan berkas lain lengkap dengan pratinjau teks/kode hingga 64 KB (`TextAssetModal`) dan pratinjau huruf `FontFace` (`ResourcePreviewModal`).
- **Media Full View (`MediaFullView`):** Penampil gambar (*zoom* & *pan*) serta pemutar video kustom (*seek bar*, *playback speed* `0.5x–2x`, *volume*, *fullscreen*, navigasi panah keyboard, tombol *markah*, *salin URL*, dan *unduh*) dengan *auto-hide chrome*. Streaming media dilayani lewat `/api/assets/stream/:inspectionId/:assetId` dengan dukungan `HTTP 206 Partial Content`.

### 3.5 Markah Media, Riwayat Pencarian & Pengaturan

- **Markah Media (`/markah`):** Menyimpan koleksi tautan gambar, vektor, dan video secara lokal di peramban (maksimal 1.000 item). Dilengkapi media bawaan awal (`logo.webp` dan `into-landscape.mp4`), filter jenis, pencarian, fitur **Ekspor JSON** & **Impor JSON**, serta pemutaran langsung di `MediaFullView`.
- **Riwayat Pencarian (`/riwayat-pencarian`):** Menyimpan hingga 50 entri inspeksi terbaru (dengan strip pratinjau media hingga 12 gambar & 6 video per entri), menyamarkan parameter query sensitif (`token`, `key`, `auth`, dll.), mendukung pencarian, pengurutan (`terbaru`, `terlama`, `host`), dan pemangkasan retensi otomatis.
- **Pengaturan (`/pengaturan`):** Mengatur tema (`Gelap` sebagai default atau `Terang`), sakelar proteksi (`Filter jaringan`, `Peringatan tautan mencurigakan`, `Tolak penurunan HTTPS -> HTTP`, `Cegat navigasi keluar situs`), daftar pengecualian host persis (*allowlist* maks 100 host), manajemen/pembaruan daftar filter server, retensi riwayat (`7`, `30`, `90` hari, atau `0` tanpa batas), dan penghapusan data lokal.

---

## 4. Penyimpanan Lokal Browser (`localStorage` & `sessionStorage`)

| Penyimpanan | Kunci (`Key`) | Kegunaan | Batas / Kebijakan |
|---|---|---|---|
| `localStorage` | `cdnfree:settings:v1` | Tema (`dark`/`light`), pengaturan proteksi, privasi & *allowlistedHosts* | Maks 100 host allowlist |
| `localStorage` | `cdnfree:history:v1` | Riwayat tautan yang diperiksa & strip pratinjau media | Maks 50 entri, token disamarkan |
| `localStorage` | `cdnfree:bookmarks:v1` | Daftar markah media (gambar, vektor, video) | Maks 1.000 item |
| `localStorage` | `cdnfree:bookmarks:seeded:v1` | Penanda bahwa media bawaan telah diinisialisasi | Nilai `'1'` |
| `localStorage` | `cdnfree:search-config:v1` | Konfigurasi pencarian terakhir (Single/Bulk, tab target, filter preset) | Divalidasi & disanitasi saat baca |
| `localStorage` | `cdnfree:engine-fallback:v1` | Penghitung kegagalan Mode Engine per hostname | Auto-fallback ke Mode Ringan pada `>= 2` |
| `sessionStorage` | `cdnfree:bulk-sessions` | State sesi pencarian *Bulk Link* aktif di tab saat ini | Maks 12 sesi per tab |

---

## 5. Model Keamanan, Anti-SSRF & Batas Operasional

- **Anti-SSRF & DNS Rebinding (`server/services/url-policy.ts`, `server/security/ip-policy.ts`):**
  - Hanya mengizinkan skema `http:` dan `https:`; menolak kredensial tertanam (`user:pass@host`).
  - Menolak `localhost`, `.local`, `.internal`, `.arpa`, serta seluruh rentang IP privat (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), *loopback*, *link-local*, CGNAT (`100.64.0.0/10`), multicast, reserved, dan alamat metadata cloud (`169.254.169.254`, `fd00:ec2::254`, IPv4-mapped IPv6).
  - Validasi dilakukan saat resolusi DNS `A`/`AAAA` dan dipin langsung ke koneksi socket (`IP pinning`).
  - Wisp WebSocket (`/wisp/`) juga dikunci dengan `allow_private_ips: false`, `allow_loopback_ips: false`, `allow_direct_ip: false`, dan `port_whitelist: [80, 443]`.
- **Proteksi API & Header Keamanan (`server/app.ts`):**
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - Proteksi CSRF sederhana pada `/api` dengan menolak `POST` yang memiliki `Sec-Fetch-Site: cross-site`.
  - Sanitasi SVG (`svg-sanitizer.ts`) menghapus elemen `<script>`, event handler `on*`, `<foreignObject>`, serta skema `javascript:`/`data:text/html`.
- **Pengunduhan Aset Terikat Sesi (`POST /api/assets/download`):**
  - Hanya menerima `{ inspectionId, resourceId }` dari `InspectionStore` aktif (bukan URL bebas).
  - Memvalidasi ulang DNS/SSRF/MIME, menolak respons berautentikasi (`401`/`402`/`403`/`WWW-Authenticate`), skrip, HTML, maupun file eksekutabel, serta mengirim header `Content-Disposition: attachment` (RFC 5987) + `Content-Security-Policy: sandbox; default-src 'none'`.

### Tabel Batas Operasional (`server/security/request-limits.ts` & `proxy-route.ts`)

| Parameter | Nilai Batas | Konteks |
|---|---|---|
| `REQUEST_TIMEOUT_MS` | `8.000 ms` (8 detik) | Timeout permintaan inspeksi URL |
| `ASSET_DOWNLOAD_TIMEOUT_MS` | `12.000 ms` (12 detik) | Timeout unduhan aset |
| `MAX_REDIRECT_HOPS` | `8 hop` | Batas maksimum pelacakan pengalihan |
| `MAX_HTML_BYTES` | `2 MiB` | Batas ukuran HTML (terkompresi & dekompresi) saat inspeksi |
| `MAX_ASSET_DOWNLOAD_BYTES` | `10 MiB` | Batas ukuran unduhan via `POST /api/assets/download` |
| `PROXY_LIMITS.html` / `.text` | `8 MiB` / `1 MiB` | Batas HTML & file teks (CSS/JS/SVG/M3U8) di Mode Ringan |
| `DEFAULT_MAX_STREAM_BYTES` | `2 GiB` | Batas *streaming* media (kecuali permintaan *Range* video/audio) |
| `MAX_CONCURRENT_INSPECTIONS` | `16` | Batas konkurensi inspeksi di server |
| `MAX_CONCURRENT_DOWNLOADS` | `6` | Batas konkurensi unduhan aset di server |
| Rate Limit API & Proxy | `120 req / 60 detik` | Batas sliding-window per IP untuk `/api/inspect`, `/api/assets/download`, `/api/proxy` |
| Rate Limit Asset & Stream | `1.200 req / 60 detik` | Batas sliding-window per IP untuk `/api/asset` & `/api/assets/stream` |
| Rate Limit Refresh Filter | `6 req / 60 detik` | Batas sliding-window per IP untuk `POST /api/filters/refresh` |
| TTL `InspectionStore` | `30 menit` (maks `100` entri) | Cache hasil inspeksi di memori server |

---

## 6. Sumber Daftar Filter & Atribusi

- **Cadangan Bawaan Luring (`server/data/baseline-filters.txt`):** `CDNFREE Baseline` (44 aturan jaringan terverifikasi) — *EasyList & EasyPrivacy Authors* (`https://easylist.to/`), lisensi `CC BY-SA 3.0 / GPLv3`.
- **Sumber Jarak Jauh Opsional (Pembaruan Manual via `POST /api/filters/refresh`):**
  - `EasyList (Resmi)` — `https://easylist.to/easylist/easylist.txt` (`CC BY-SA 3.0 / GPLv3`).
  - `EasyPrivacy (Resmi)` — `https://easylist.to/easylist/easyprivacy.txt` (`CC BY-SA 3.0 / GPLv3`).
  - `Peter Lowe's Ad & Tracking Server List` — `https://pgl.yoyo.org/adservers/...` (gratis untuk pemblokiran dengan atribusi).
- **Kebijakan & Cakupan Sintaks (`filter-engine.ts` v1.2.0):**
  - Sumber jarak jauh berstatus awal `stale` (*Belum disinkronkan*) hingga pembaruan manual berhasil, menggunakan header kondisional `If-None-Match` / `If-Modified-Since`, validasi origin HTTPS ketat, perlindungan SSRF, dan pelestarian *last-known-good* jika pembaruan gagal.
  - Mengevaluasi subset aturan jaringan terindeks domain (`||domain^`, `@@||domain^`, jalur statis, `$third-party` berbasis `public-suffix.ts`). Aturan kosmetik (`##`) dan regex kompleks dilewati secara aman.

---

## 7. Tech Stack & Dependensi

| Lapisan | Teknologi / Package | Peran |
|---|---|---|
| **Frontend UI** | `react` (`^19.0.1`), `react-dom`, `react-router-dom` (`^7.18.5`) | Aplikasi SPA, routing & manajemen state |
| **Styling & Ikon** | `tailwindcss` (`^4.3.3`), `@tailwindcss/vite`, `@fontsource-variable/inter`, `lucide-react`, `motion` | Desain sistem tema gelap/terang, ikon & transisi |
| **Pratinjau Dokumen** | `pdfjs-dist` (`^6.5.438`) | Rendering thumbnail halaman pertama & viewer PDF interaktif |
| **Validasi Skema** | `zod` (`^4.6.7`) | Validasi payload request backend & respons API di frontend |
| **Backend Server** | `express` (`^4.21.2`), `compression`, `dotenv`, `tsx` (`^4.21.0`) | Server HTTP, API inspeksi, proxy, streaming & eksekusi TypeScript |
| **Parser & Konkurensi** | `cheerio` (`^1.2.0`), `p-limit` (`^7.3.3`) | Ekstraksi HTML statis & pembatasan konkurensi *deep asset scanner* |
| **Mode Engine Proxy** | `@mercuryworkshop/scramjet`, `scramjet-controller`, `scramjet-utils`, `libcurl-transport`, `wisp-js` | Browser-in-browser Service Worker rewriter & transport WebSocket Wisp |
| **Build & Tooling** | `vite` (`^8.3.0`), `@vitejs/plugin-react`, `typescript` (`^7.0.2`), `esbuild` | Bundling produksi & pemeriksaan tipe statis |

---

## 8. Instalasi, Perintah Pengembangan & Pengujian

Pastikan **Node.js (>= 20)** sudah terpasang, lalu instal seluruh dependensi:

```bash
npm install
```

### Perintah yang Tersedia (`package.json`)

```bash
# Menjalankan dev server Express + Vite middleware + Wisp pada port 3000
npm run dev

# Membangun bundle produksi frontend ke dist/
npm run build

# Menjalankan server produksi (melayani API, /p/*, /wisp/ & dist/)
npm start

# Menjalankan seluruh unit & integration test (node:test via tsx)
npm test

# Pemeriksaan tipe TypeScript
npm run typecheck

# Validasi lint / tipe
npm run lint

# Memastikan seluruh file di src/, server/, scripts/, tests/ <= 600 baris
npm run check:length

# Validasi header & aturan pada server/data/baseline-filters.txt
node scripts/validate-filter-sources.cjs

# Membersihkan hasil build (dist/ dan server.js)
npm run clean
```

---

## 9. Variabel Lingkungan & Deployment

### Variabel Lingkungan (`.env.example`)

- `PORT` — Port HTTP server aplikasi (default `3000`).
- `NODE_ENV` — Mode eksekusi (`development` atau `production`).
- `DISABLE_HMR` — Bila bernilai `'true'`, mematikan Vite HMR dan file watching (berguna di lingkungan kontainer/sandbox).
- `ENABLE_HMR` — Mengaktifkan kembali HMR secara eksplisit di mode development bila `DISABLE_HMR !== 'true'`.
- `APP_URL` — URL layanan publik tempat aplikasi di-host (disuntikkan otomatis oleh runtime cloud).
- `GEMINI_API_KEY` — Variabel lingkungan runtime dari `.env.example`. *(Catatan privasi: CDNFREE tidak mengirimkan URL maupun isi halaman yang diperiksa pengguna ke layanan AI pihak ketiga.)*

### Catatan Deployment (`vercel.json` vs Server Node Persisten)

- **Server Node.js Penuh (`npm run build && npm start`):** Mendukung seluruh fitur termasuk WebSocket `/wisp/` (Mode Engine), `InspectionStore`, *Session Cookie Jar*, *streaming* HTTP 206, dan *proxy* Mode Ringan secara penuh.
- **Vercel (`vercel.json` + `api/index.ts`):** Mengarahkan `/api/*` dan `/view` ke fungsi serverless Express dengan menyertakan `server/data/**`. *(Catatan: endpoint WebSocket `/wisp/` memerlukan server Node.js/HTTP persisten yang mendukung `upgrade` WebSocket).*

---

## 10. Perilaku yang Didukung & Keterbatasan Diketahui

### Didukung
- Normalisasi & perbaikan otomatis URL terpecah (*Smart URL Parser*), penyamaran token sensitif di riwayat, serta dukungan inspeksi tunggal maupun massal (*Bulk Link* paralel).
- Penelusuran rantai redirect HTTP/HTTPS (maks 8 hop) + deteksi *client-side redirect* dan identifikasi host CDN.
- Pratinjau web terisolasi dual-mode (**Mode Engine** Scramjet + Wisp dan **Mode Ringan** reverse proxy) serta pratinjau langsung berkas non-HTML.
- Ekstraksi aset statis & sekunder mendalam (CSS, JS entry, manifest, M3U8/MPD), pratinjau galeri gambar/SVG/video/audio/PDF, *Range streaming*, dan pengunduhan aset publik tervalidasi.
- Pengelolaan markah media lokal lengkap dengan impor/ekspor JSON serta riwayat pencarian yang dapat diatur retensinya.

### Tidak Didukung & Keterbatasan
- **Konten DRM & Layanan Berlangganan:** Video atau siaran dengan proteksi enkripsi DRM (EME) tidak dapat diputar.
- **Tantangan Bot / CAPTCHA Ketat:** Situs dengan tantangan bot interaktif tingkat lanjut (mis. Cloudflare Turnstile/JS Challenge atau login dengan verifikasi ketat) dapat tetap menolak akses melalui proxy.
- **Penyimpanan Memori Proses Tunggal di Server:** `InspectionStore`, `CapturedAssetStore`, `SessionCookieJarStore`, `SlidingWindowRateLimiter`, dan `FilterSourceManager` berjalan di memori proses tunggal. Saat server dimulai ulang, unduhan aset pada riwayat lama memerlukan pemeriksaan ulang URL. Untuk penskalaan horizontal multi-instance, pindahkan penyimpanan sesi/inspeksi ke store terdistribusi (mis. Redis).
- **Isolasi Egress Jaringan Produksi:** Selain validasi SSRF/DNS/socket di lapisan aplikasi, lingkungan produksi tetap harus menerapkan *egress firewall* / kebijakan VPC yang memblokir akses keluar ke subnet privat dan metadata cloud (`169.254.169.254`).
