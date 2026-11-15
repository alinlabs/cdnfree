# Rencana Perbaikan Menyeluruh CDNFREE: Konsistensi Full View, Pemulihan Mode Web, Reliabilitas Gambar & Stabilitas Runtime

Menyelaraskan mekanisme kartu media dan tampilan penuh (*Full View*) antara Aset Manager, Markah Media, dan Riwayat Pencarian, memulihkan penayangan halaman pada Mode Web melalui proxy *same-origin*, memperkuat rantai pemuatan gambar agar tidak gagal muat, serta menghilangkan galat konsol Vite WebSocket dan `ResizeObserver`.

## User Review & Critical Decisions

> [!IMPORTANT]
> Pertanyaan klarifikasi dilewati pada tahap awal, sehingga rencana ini menggunakan pendekatan yang direkomendasikan dan aman untuk menjaga seluruh fitur CDNFREE yang sudah berjalan tetap utuh.

- **Konsistensi Kartu & Full View (Aset Manager, Markah Media, dan Riwayat Pencarian)**: Menyatukan mesin galeri dan kontrol *Full View* di ketiga halaman. Halaman Markah Media dipulihkan pemisahan galeri Vektor/SVG-nya agar identik dengan Aset Manager, sementara halaman Riwayat Pencarian diperkaya agar menyimpan cuplikan aset media per riwayat inspeksi sehingga pengguna dapat langsung melihat kartu gambar/vektor/video dan membuka *MediaFullView* dengan mekanisme navigasi, zoom, unduh, salin, dan markah yang sama persis.
- **Tata Letak & Reliabilitas Mode Web**: Mempertahankan pengalaman imersif *full-viewport* dengan tombol menu mengambang yang sudah ada sebagai standar, sekaligus menambahkan indikator pemuatan, perbaikan penyematan *iframe* lintas pratinjau, perbaikan resolusi URL relatif di dalam proxy, serta kartu pemulihan cepat jika situs tujuan gagal dimuat.

---

### 1. Overview & Core Concept

- **What It Does**: Menghadirkan empat perbaikan inti yang saling melengkapi:
  1. **Pengalaman Galeri & Full View Seragam**: Seluruh kartu gambar, vektor/SVG, dan video beserta jendela *MediaFullView* (zoom, pan, rotasi, balik horizontal/vertikal, ganti latar terang/gelap, pintasan keyboard, navigasi item sebelumnya/berikutnya, markah, salin URL, dan unduh) bekerja identik di Aset Manager, Markah Media, maupun Riwayat Pencarian.
  2. **Mode Web Benar-Benar Tampil**: Proxy HTML *same-origin* tidak lagi mematahkan pemuatan skrip/gaya/rute relatif SPA akibat injeksi `<base href="/">` atau penimpaan riwayat path sebelum aset termuat, serta mendukung kebijakan *framing* pratinjau AI Studio/Cloud Run dan gulir dokumen yang wajar di dalam *iframe*.
  3. **Pemuatan Gambar & Vektor Tangguh**: Menghentikan permintaan `/api/assets/stream` ke ID aset sisi-klien yang pasti menghasilkan `404`, memperkuat proxy aset dengan pemulihan header *Referer* dan deteksi respons galat HTML, serta menambahkan rantai *fallback* URL terdeduplikasi hingga pemuatan HTTPS langsung yang aman.
  4. **Konsol Bersih Tanpa Galat Runtime**: Menonaktifkan inisialisasi klien WebSocket HMR Vite pada mode *middleware* yang tidak mendukung soket persisten di belakang *reverse proxy* Cloud Run, serta menunda pembaruan `ResizeObserver` ke siklus `requestAnimationFrame`.
- **Target Audience / Persona**: Pengembang web, analis aset digital, dan pengguna umum yang memeriksa struktur tautan, mempratinjau situs secara aman, dan mengoleksi aset gambar/vektor/video melalui CDNFREE pada desktop maupun perangkat sentuh.
- **Key Value**: Pengguna tidak lagi menemui layar putih di Mode Web, galeri bebas dari ikon gambar pecah yang sebenarnya masih bisa dimuat, riwayat pencarian langsung menampilkan aset visual siap inspeksi penuh, dan log konsol bebas dari galat berulang.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Alur Mode Web**: Pengguna memasukkan URL di Beranda → diarahkan ke tab Web → melihat progres pemuatan singkat di atas bingkai → halaman target tampil penuh dengan skrip/gambar/gaya aktif dan dapat digulir wajar → pengguna dapat membuka menu mengambang atau bilah kontrol untuk berpindah ke tab Aset, Detail, atau Muat Ulang. Jika upstream menolak/timeout, pesan pemulihan yang jelas dan tombol buka ulang/tab baru tampil tanpa layar kosong.
  2. **Alur Konsistensi Kartu & Full View**: Pengguna membuka kartu gambar, vektor SVG, atau video di **Aset Manager**, **Markah Media**, atau **Riwayat Pencarian** → efek transisi *fullscreen* dan tata letak kartu (`Galeri foto`, `Vektor & SVG`, `Galeri video`) tampil seragam → klik kartu langsung membuka *MediaFullView* dengan sinkronisasi parameter URL (`?view=...&item=...`) dan dukungan tombol Kembali/Escape/Panah kiri-kanan yang identik.
  3. **Alur Pemuatan Gambar Tangguh**: Saat galeri dibuka, setiap kartu memilih URL sumber paling valid (stream server terverifikasi → proxy `/api/asset` → pemuatan HTTPS langsung *no-referrer* untuk domain aman yang memblokir IP server) tanpa pernah mengulang URL yang identik dua kali.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Konsol inspeksi web dan pengelola aset bergaya editorial-teknis yang bersih, presisi, tanpa efek dekoratif berlebihan atau teks status semu.
  - *Color Palette & Mood*: Mempertahankan token tema CDNFREE yang sudah ada (`--color-bg`, `--color-surface`, `--color-surface-subtle`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-amber`, `--color-success`, `--color-danger`) dengan disiplin rasio **60% kanvas netral — 30% permukaan struktural — 10% aksen amber** serta dukungan penuh mode terang/gelap.
  - *Typography & Hierarchy*: Mempertahankan pasangan tipografi proyek (`Plus Jakarta Sans` / sistem font proyek) dengan angka tabular (`tabular-nums`) untuk seluruh ukuran berkas, jumlah aset, indeks *Full View*, dan stempel waktu riwayat.
  - *Component Styling & Layout*: Kedalaman kartu tunggal berbasis garis tepi halus 1px dan latar papan catur transparan (`--color-checker-bg`) untuk foto/vektor. Kartu pada Riwayat Pencarian memanfaatkan strip/galeri terstruktur dengan garis pemisah tipis (`divide-y`) dan ruang napas yang lega tanpa menumpuk kartu bersarang.
- **Interactive Feedback & Motion**:
  - Indikator progres pemuatan bingkai Web yang halus dan otomatis menghilang begitu `cdnfree:ready` atau `load` tercapai.
  - Transisi *hover* kartu dan kontrol *Full View* dibatasi pada properti kompositor (`opacity`, `transform`) dengan durasi $\le 200\text{ms}$ serta mematuhi `prefers-reduced-motion`.
  - Seluruh salinan antarmuka, keadaan kosong (*empty state*), dan pesan galat tetap menggunakan bahasa Indonesia yang ringkas dan jelas.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Pengayaan Halaman Riwayat dengan Cuplikan Media & Full View**
  - *Chosen Approach*: Menyimpan ringkasan terkurasi dari aset media terverifikasi/utama (gambar, vektor, video; dibatasi agar hemat kuota penyimpanan peramban) pada setiap entri riwayat baru, sekaligus menghidrasi aset lengkap dari sesi inspeksi server bila masih aktif. Entri riwayat menampilkan pratinjau kartu galeri standar CDNFREE yang terhubung langsung ke *MediaFullView*.
  - *Why*: Menjamin kesamaan penuh mekanisme kartu dan *Full View* baik ketika pengguna menafsirkan "halaman riwayat" sebagai **Riwayat Pencarian** maupun sebagai **Markah Media** (koleksi tersimpan). Pengguna tetap bisa menelusuri daftar URL seperti biasa, namun kini juga langsung memiliki pratinjau media & *Full View* konsisten di sana.
  - *Alternatives Considered*: Hanya menyamakan Markah Media dan Aset Manager; ditolak karena pengguna secara eksplisit menyebut "halaman riwayat". Menyimpan ribuan aset penuh ke `localStorage` juga dihindari karena berisiko melampaui batas kuota ~5 MB.

- **Decision 2: Pemisahan Vektor & Sinkronisasi URL Full View di Semua Galeri Media**
  - *Chosen Approach*: Mengekstrak komponen komposisi galeri media terpadu (Galeri Foto + Galeri Vektor SVG + Galeri Video + pengelola *MediaFullView*) beserta sinkronisasi query parameter URL (`view` dan `item`, serta dukungan penanda grup/entri pada Riwayat).
  - *Why*: Sebelumnya Markah Media menaruh SVG di galeri foto (`object-cover` terpotong) dan hanya memakai state lokal sementara Aset Manager memakai `VectorGallery` (`object-contain`) dan URL query state. Satu sumber kebenaran memastikan perilaku klik, navigasi *Prev/Next* lintas foto & vektor, tombol *Back* peramban, dan mode layar penuh selalu identik.
  - *Alternatives Considered*: Menyalin logika dari Aset Manager ke Markah dan Riwayat secara terpisah; ditolak karena rentan kembali tidak sinkron di kemudian hari.

- **Decision 3: Mengganti Injeksi `<base href="/">` & Menjinakkan `history.replaceState` pada Proxy Web**
  - *Chosen Approach*: Menghapus injeksi `<base href="/">` yang mengarah ke root aplikasi CDNFREE, mengganti strategi resolusi aset dinamis pada *shim* agar tetap merujuk ke URL asli situs target (`T`), mencegah `location.reload()` / resolusi relatif SPA menabrak server Vite CDNFREE, serta memperluas header `Content-Security-Policy: frame-ancestors` untuk seluruh domain pratinjau Google AI Studio (`*.usercontent.goog`, `*.google.com`, `*.gstatic.com`, `*.googleusercontent.com`, `*.run.app`).
  - *Why*: `<base href="/">` membelokkan seluruh permintaan skrip, modul ES, font, dan XHR relatif situs target ke asal CDNFREE, sehingga Vite mengembalikan HTML beranda CDNFREE (bukan aset target) dan menyebabkan layar Web kosong. Demikian pula kebijakan `frame-ancestors` yang terlalu sempit memblokir penyematan *iframe* pratinjau pada lingkungan host berantai.
  - *Alternatives Considered*: Memasang *reverse proxy* root pada jalur acak aplikasi utama; ditolak karena akan bertabrakan dengan rute SPA CDNFREE (`/search`, `/markah`, `/riwayat-pencarian`).

- **Decision 4: Rantai Fallback Gambar 3-Tingkat Tanpa Permintaan 404 Palsu**
  - *Chosen Approach*: Memperbaiki resolver URL stream agar hanya memakai `/api/assets/stream/:inspectionId/:assetId` untuk ID aset yang benar-benar terdaftar di server, membekali `/api/asset` dengan percobaan ulang otomatis tanpa header `Referer` saat upstream membalas `401`/`403`/`406` serta validasi agar halaman HTML tantangan anti-bot tidak dikirim sebagai gambar, dan menyusun fallback klien terdeduplikasi: `stream server (jika tersedia) -> /api/asset -> URL HTTPS langsung (no-referrer)`.
  - *Why*: Memangkas puluhan hingga ratusan request `404` dan `403` sia-sia saat galeri dibuka serta menyelamatkan gambar dari CDN yang memblokir alamat IP *cloud server* namun mengizinkan permintaan gambar standar dari peramban pengguna.
  - *Alternatives Considered*: Hanya mengandalkan `/api/asset`; ditolak karena CDN tertentu memblokir IP pusat data Cloud Run secara permanen meski aset tersebut aman dimuat sebagai tag `<img>` `no-referrer`.

- **Decision 5: Menonaktifkan Klien WebSocket HMR Vite Secara Bersih di Server Dev**
  - *Chosen Approach*: Mengonfigurasi instance `createViteServer` di sisi server Node untuk menonaktifkan HMR WebSocket secara eksplisit saat berjalan dalam *middlewareMode* di lingkungan pratinjau non-lokal / tanpa soket HMR (`hmr: false`), sambil tetap menjaga fungsi konfigurasi Vite utama tetap kompatibel.
  - *Why*: Dalam mode *middlewareMode* tanpa `httpServer` terpasang dan di balik *reverse proxy* Cloud Run, skrip `@vite/client` terus mencoba membuka soket `wss://` ke port/host yang ditutup oleh *proxy*, memicu error dan `Unhandled Rejection` di konsol.
  - *Alternatives Considered*: Membuka server WebSocket terpisah pada port lain; tidak memungkinkan karena lingkungan runtime hanya mengekspos satu port `3000`.

---

### 4. Technical Architecture & Data Strategy

#### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                          CDNFREE FRONTEND (React SPA)                        │
├──────────────────────┬───────────────────────────┬───────────────────────────┤
│   Aset Manager Tab   │       Markah Media        │     Riwayat Pencarian     │
│ (/search/aset)       │ (/markah)                 │ (/riwayat-pencarian)      │
└──────────┬───────────┴────────────┬──────────────┴─────────────┬─────────────┘
           │                        │                            │
           └────────────────────────┼────────────────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│             Shared Media Gallery & Full View Engine (Unified UX)             │
│  ┌────────────────┐ ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ ImageGallery   │ │ VectorGallery   │ │ VideoGallery │ │ MediaFullView  │  │
│  │ (Foto, 3-4 kol)│ │ (SVG contain)   │ │ (Video Mini) │ │ (URL Sync +    │  │
│  └───────┬────────┘ └────────┬────────┘ └──────┬───────┘ │  Fullscreen +  │  │
│          └───────────────────┼─────────────────┘         │  Zoom/Rotate)  │  │
│                              ▼                           └────────┬───────┘  │
│             Resilient Image Source Chain Hook                     │          │
│     [1. Verified Server Stream] ──► [2. /api/asset] ──► [3. HTTPS Direct]    │
│             (rAF-guarded ResizeObserver across viewers & stage)              │
└──────────────────────────────────────────────────────────────────────────────┘
           │                                                │
           │ (Iframe Preview / Proxy Mode Web)              │ (Asset / Stream API)
           ▼                                                ▼
┌──────────────────────────────┐            ┌──────────────────────────────────┐
│   TabWeb + useWebFrame       │            │     Express Server (Port 3000)   │
│  - Loading & fallback state  │            │  - Vite middleware (hmr: false)  │
│  - rAF ResizeObserver        │◄──────────►│  - Expanded CSP frame-ancestors  │
│  - Scroll-friendly viewport  │  /api/proxy│  - Smart HTML/CSS/ESM rewriter   │
└──────────────────────────────┘            │  - Shim w/o <base href="/"> trap │
                                            │  - /api/asset Referer retry &    │
                                            │    HTML-challenge rejection      │
                                            └──────────────────────────────────┘
```

#### Data Model & State

- **HistoryEntry (Diperkaya)**:
  - Mempertahankan field inti (`id`, `url`, `displayUrl`, `host`, `title`, `inspectedAt`, `status`) dengan tambahan opsional `previewResources?: ResourceRecord[]` dan `totalResourceCount?: number`.
  - Saat pemeriksaan URL selesai, hingga 12 aset media utama teratas (prioritas foto, vektor, video yang aman dan tervalidasi) disimpan ringkas ke riwayat peramban dengan sanitasi panjang data agar penyimpanan lokal tetap aman dari *quota overflow*.
  - Saat halaman Riwayat dibuka, entri yang masih memiliki sesi aktif di server dapat diperkaya kembali, sementara entri lama tetap bisa menampilkan kartu galeri dan *MediaFullView* dari `previewResources` tersimpan.
- **Resilient Image Candidate Queue**:
  - Setiap komponen pemuat gambar (`LazyImageCard`, `VectorCard`, `CustomImageViewer`) memakai daftar kandidat URL unik tanpa duplikasi:
    1. URL `/api/assets/stream/:id/:assetId` **hanya** jika aset memang berasal dari ID sisi-server yang terverifikasi (bukan ID observasi DOM `dom-*` atau ID tanpa sesi).
    2. URL proxy *same-origin* `/api/asset?u=...&sid=...`.
    3. URL HTTPS asli aset (`referrerPolicy="no-referrer"`) bila skema aman dan belum diblokir kebijakan MIME non-gambar.
- **Full View State**:
  - Dikelola seragam melalui helper navigasi URL (`?view=image|video&item=...` dan opsional `&entry=...` pada Riwayat) sehingga tindakan klik kartu, pintasan keyboard (`Escape`, panah kiri/kanan), tombol Kembali peramban, dan transisi layar penuh bekerja konsisten di ketiga halaman.

#### Interactive Component & State Mapping

- **Shared Media Gallery Section + Full View Controller**:
  - Mempartisi sumber daya menjadi `imageAssets`, `vectorAssets`, dan `validVideoAssets`.
  - Menangani pembukaan `MediaFullView` (`onOpenFullView`), pergantian item (`onChangeIndex` mencakup gabungan `[...imageAssets, ...vectorAssets]` untuk foto/vektor dan `validVideoAssets` untuk video), penutupan (`onClose` keluar dari mode layar penuh & membersihkan query), serta status markah/salin/unduh yang terhubung ke store markah dan layanan unduhan.
- **TabWeb & Frame Lifecycle (`useWebFrame`)**:
  - Menyimpan status pemuatan bingkai (`loading`, `ready`, `error`), membatasi tinggi bingkai secara aman tanpa mematikan pengguliran internal untuk situs penuh (`100vh`/SPA), dan membungkus callback `ResizeObserver` dengan `requestAnimationFrame` plus pembersihan penuh pada unmount atau perpindahan URL.
- **Proxy Pipeline (`/api/proxy` & `/api/asset`)**:
  - `/api/proxy`: Menjaga resolusi URL relatif berbasis URL target asli `T`, menormalkan `history.replaceState` agar tidak merusak path relatif SPA maupun memuat ulang bundel CDNFREE saat reload, menyuntikkan header `Content-Security-Policy: frame-ancestors` yang kompatibel dengan host AI Studio, dan menaikkan batas laju agar navigasi sub-bingkai tidak terkena `429`.
  - `/api/asset` & `/api/assets/stream`: Mengirim header `Accept` khusus media, mencoba ulang otomatis tanpa `Referer` bila mendapat respons `401`/`403`/`406`, menolak respons `text/html` palsu saat targetnya adalah gambar agar fallback sisi-klien bekerja, serta menaikkan ambang *rate limiter* agar pemuatan galeri besar tetap lancar.
- **Dev Server & Viewer Stages**:
  - Konfigurasi dev server menonaktifkan HMR WebSocket pada mode *middleware* bila tidak didukung untuk membasmi pesan galat soket Vite.
  - `CustomImageViewer` dan `useMediaStage` menjadwalkan pembacaan `getBoundingClientRect()` di dalam `requestAnimationFrame` agar `ResizeObserver` tidak pernah memicu *loop notification error*.
