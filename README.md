# CDNFREE

**CDNFREE** adalah aplikasi web inspeksi tautan, penelusuran rantai pengalihan (*redirect chain*), inventaris aset HTML statis, identifikasi host CDN, klasifikasi aturan daftar filter jaringan, serta pengunduhan aset publik tervalidasi.

CDNFREE membantu pengguna memahami tujuan akhir tautan, tautan atau pola pengalihan yang perlu ditinjau, serta aset statis yang terekspos oleh halaman sebelum membukanya secara langsung.

---

## Perintah Pengaturan & Eksekusi

Pastikan Node.js (>= 20) dan dependensi sudah terpasang:

```bash
npm install
```

### Pengembangan (Dev Server)

Menjalankan server Express + Vite middleware pada port `3000`:

```bash
npm run dev
```

### Build & Produksi

```bash
npm run build
npm start
```

### Pengujian & Validasi Kualitas

```bash
npm test                                    # Unit & integration tests (node:test via tsx)
npm run typecheck                           # Pemeriksaan tipe TypeScript (tsc --noEmit)
npm run lint                                # Validasi lint/tipe
npm run check:length                        # Memastikan seluruh file sumber <= 600 baris
node scripts/validate-filter-sources.cjs    # Validasi header & aturan daftar filter baseline
```

---

## Variabel Lingkungan (Environment Variables)

Hanya nama variabel (tanpa nilai rahasia yang disimpan di repositori):

- `PORT` — Port HTTP server aplikasi (default `3000`).
- `NODE_ENV` — Mode runtime (`development` atau `production`).
- `APP_URL` — URL layanan tempat aplikasi di-host (disuntikkan oleh lingkungan runtime).
- `GEMINI_API_KEY` — Variabel runtime platform dari `.env.example`. **Catatan privasi:** CDNFREE tidak mengirim URL atau isi halaman yang diperiksa ke layanan AI pihak ketiga.

---

## Arsitektur

- **Frontend (`src/`):** React 19 + TypeScript + React Router + Tailwind CSS v4 dengan tema terang (`#FFFFFF`), tipografi `@fontsource-variable/inter`, validasi batas API menggunakan `zod`, dan penyimpanan lokal berversi (`localStorage`) untuk riwayat (`cdnfree:history:v1`) serta pengaturan (`cdnfree:settings:v1`).
  - `/` (`Beranda`): Input URL, ringkasan kapabilitas, dan riwayat singkat terbaru.
  - `/hasil-pencarian`: Workspace inspeksi tiga tab (`Web`, `Ringkasan`, `Aset`) dengan header hasil terpadu (`Kembali ke Beranda`, input URL ringkas, aksi tautan, dan pemicu `Buka detail inspeksi`), pratinjau sandbox terbatas atau fallback di tab `Web`, laporan inspeksi & rantai pengalihan di tab `Ringkasan`, galeri foto/video serta daftar ringkas aset lain di tab `Aset`, dan `Drawer` detail inspeksi di sisi kanan.
  - `/riwayat-pencarian`: Pencarian, pengurutan, pembukaan ulang hasil, penghapusan per item/semua dengan konfirmasi, serta pemangkasan retensi otomatis.
  - `/pengaturan`: Kontrol proteksi yang terhubung ke API (`POST /api/inspect`), status & pembaruan manual daftar filter (`GET /api/filters/status`, `POST /api/filters/refresh`), pengecualian host persis, kontrol retensi & penghapusan data lokal.
- **Backend (`server.ts`, `server/`):** Express server yang mengeksekusi seluruh pengambilan jaringan eksternal dari sisi server (`POST /api/inspect`, `GET /api/inspect/:id`, `POST /api/assets/download`, `GET /api/filters/status`, `POST /api/filters/refresh`, `GET /api/health`) serta `InspectionStore` berbatas TTL di memori.

---

## Model Keamanan

- **Perlindungan SSRF & DNS Rebinding:** Hanya mengizinkan skema `http:` dan `https:`, menolak kredensial tertanam, menolak `localhost`/`.local`/`.internal`/`.arpa` serta rentang IP privat, loopback, link-local, CGNAT, multicast, reserved, dan metadata cloud (IPv4 & IPv6 termasuk IPv4-mapped IPv6). Validasi dilakukan pada resolusi DNS A/AAAA maupun pada saat koneksi socket (`socket.connect`) dengan pinning IP (`agent: false`).
- **Validasi Redirect & Anti-DoS:** Mengikuti redirect secara manual maksimal 8 hop dengan revalidasi setiap hop, deteksi loop, opsi penolakan penurunan HTTPS ke HTTP, batas ukuran HTML 2 MiB (terkompresi & hasil dekompresi gzip/deflate/br), batas unduhan aset 10 MiB, batas waktu total (*wall-clock timeout*) 8 detik / 12 detik, pembatas konkurensi, dan *rate limiter*.
- **Ekstraksi Statis Tanpa Eksekusi Skrip:** HTML diurai secara statis dengan `cheerio`; tidak ada skrip halaman yang dijalankan di server dan tidak ada HTML eksternal yang disajikan dari origin CDNFREE.
- **Pratinjau & Navigasi Eksternal:** Iframe pratinjau hanya dicoba bila header tujuan (`X-Frame-Options` / CSP `frame-ancestors`) mengizinkan, menggunakan `sandbox="allow-scripts allow-forms"` dan `referrerPolicy="no-referrer"`. Pembukaan tautan eksternal selalu diawali tindakan pengguna dan dialog konfirmasi.
- **Pengunduhan Aset Publik Terikat Sesi:** `POST /api/assets/download` hanya menerima `{ inspectionId, resourceId }` dari inspeksi aktif (bukan URL bebas dari browser), memvalidasi ulang URL/DNS/redirect/MIME, menolak respons berautentikasi (`401`/`402`/`403`/`WWW-Authenticate`), skrip/HTML/eksekutabel, dan mengirim respons dengan `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, dan `Content-Security-Policy: sandbox; default-src 'none'`.
- **Proteksi API & Privasi:** Menolak header `Cookie`/`Authorization` diteruskan ke host tujuan, menyamarkan parameter query sensitif di log/riwayat, dan menolak permintaan `POST` lintas situs (`Sec-Fetch-Site: cross-site`).

---

## Sumber Filter & Atribusi

- **Cadangan Bawaan Luring:** `server/data/baseline-filters.txt` (`CDNFREE Baseline`, 44 aturan) — EasyList & EasyPrivacy Authors (`https://easylist.to/`), lisensi `CC BY-SA 3.0 / GPLv3`.
- **Sumber Jarak Jauh Opsional (Pembaruan Manual via `POST /api/filters/refresh`):**
  - `EasyList (Resmi)` (`https://easylist.to/easylist/easylist.txt`, `CC BY-SA 3.0 / GPLv3`).
  - `EasyPrivacy (Resmi)` (`https://easylist.to/easylist/easyprivacy.txt`, `CC BY-SA 3.0 / GPLv3`).
  - `Peter Lowe's Ad & Tracking Server List` (`https://pgl.yoyo.org/adservers/...`, gratis untuk pemblokiran dengan atribusi).
- **Kebijakan Sinkronisasi & Kesegaran:** Sumber jarak jauh dimulai dengan status `stale` (`Belum disinkronkan`) hingga pembaruan manual berhasil, memakai validasi origin HTTPS ketat, perlindungan SSRF/DNS/socket, batas 8 MiB & 10 detik, header kondisional `If-None-Match` / `If-Modified-Since`, serta pelestarian *last-known-good* jika pembaruan gagal.
- **Cakupan Sintaks & Feed Reputasi:** Parser v1.2.0 mengeksekusi subset aturan jaringan terindeks domain (`||domain^`, `@@||domain^`, jalur statis, `$third-party` berbasis `server/services/public-suffix.ts` termasuk multi-label ccTLD). Aturan kosmetik (`##`), regex kompleks, dan opsi `$` yang belum didukung dilewati secara aman. Feed `known-malicious` (mis. URLhaus pascapensiun unduhan tanpa kunci) tidak diaktifkan tanpa kunci API resmi.

---

## Perilaku yang Didukung & Tidak Didukung

### Didukung
- Normalisasi URL, penyamaran token pada URL riwayat, dan penelusuran rantai redirect HTTP/HTTPS.
- Ekstraksi metadata halaman, host CDN (berbasis bukti host yang diketahui), dan inventaris aset statis HTML.
- Pencocokan subset daftar filter jaringan dengan prioritas aturan pengecualian `@@` dan daftar host pengecualian pengguna.
- Pratinjau dalam sandbox terbatas bila diizinkan header tujuan, atau fallback `Buka situs di tab baru`.
- Pengunduhan aset media/stylesheet/font/PDF publik yang lolos validasi ulang server.

### Tidak Didukung
- **Bukan peramban penuh / bukan pemblokir iklan universal:** CDNFREE adalah aplikasi inspeksi web dan tidak mengklaim kompatibilitas penuh uBlock Origin atau pemblokiran seluruh permintaan jaringan di dalam iframe lintas-asal.
- **Tidak mem-bypass kontrol akses:** Tidak melakukan bypass CAPTCHA, anti-bot, login, paywall, DRM, atau klik otomatis pada tautan verifikasi.
- **Tidak mengeksekusi JavaScript halaman:** Aset yang baru dimuat secara dinamis setelah eksekusi skrip di peramban tidak selalu muncul dalam inventaris HTML statis.

---

## Keterbatasan Diketahui & Prasyarat Deployment Produksi

- **Penyimpanan & Cache Di Memori Proses Tunggal:** `InspectionStore` (TTL 30 menit, maksimum 100 entri), `SlidingWindowRateLimiter`, dan `FilterSourceManager` berjalan di memori proses tunggal. Saat server dimulai ulang, unduhan aset pada riwayat lama memerlukan pemeriksaan ulang tautan dan sumber filter jarak jauh kembali ke cadangan bawaan hingga `POST /api/filters/refresh` dijalankan. Untuk deployment multi-instance, pindahkan state ke penyimpanan terdistribusi (mis. Redis) dan tambahkan penjadwal pembaruan filter tepercaya.
- **Isolasi Egress Jaringan Produksi:** Meski validasi IP/DNS/socket telah diterapkan di lapisan aplikasi, deployment produksi tetap wajib menggunakan *egress firewall* / VPC network policy yang memblokir akses ke subnet privat dan metadata cloud (`169.254.169.254`).
- **Audit Kerentanan Dependensi:** Lingkungan ini tidak memiliki `package-lock.json` maupun akses registri daring untuk menjalankan `npm audit`; jalankan pemindaian kerentanan dependensi (`npm audit` / lockfile CI) sebelum rilis produksi.
- **Rendering Browser Terisolasi (Opsional Masa Depan):** Jika fitur rendering browser penuh ditambahkan di masa mendatang, jalankan pada origin terpisah dengan container/sandbox terisolasi, batas egress ketat, tanpa berbagi cookie/sesi aplikasi utama, serta tinjauan keamanan independen.
