# Arsitektur & Mekanisme Tampilan Web, Dual Mode (Scramjet Engine + Mode Ringan), Bypass, dan Inspeksi Aset CDNFREE (`mekanisme-web.md`)

Dokumen ini menjelaskan secara menyeluruh arsitektur **dua mode** pada tab **Web** CDNFREE:
1. **Mode Engine (Default untuk Halaman HTML)** — menggunakan **Scramjet 2.x + Wisp + Libcurl** berjalan di Service Worker `/p/` sehingga SPA modern, ESM dynamic `import()`, cookie sesi/login per situs, `POST`/`PUT`/`PATCH`, WebSocket, dan streaming dapat dijalankan layaknya peramban asli di sisi klien tanpa membawa kredensial ke server CDNFREE.
2. **Mode Ringan (Fallback Otomatis/Manual & Pratinjau Berkas Non-HTML)** — menggunakan *Same-Origin Rewriting Proxy* (`/api/proxy` + `/api/asset`) dengan parser `cheerio`, *cookie jar* sesi efemeral di memori (`sid`), anti-clickjacking, anti-frame-busting, serta mode diagnostik `?debug=1`.

---

## 1. Mengapa `<iframe src="https://situs-target">` Langsung Selalu Gagal?

Menampilkan halaman web pihak ketiga langsung di dalam `<iframe>` gagal karena 5 hambatan browser:
1. **Header Pemblokir Penyematan**: `X-Frame-Options: DENY/SAMEORIGIN` dan `CSP: frame-ancestors`.
2. **Frame-Busting JavaScript**: Pengecekan `window.top !== window.self` atau `window.frameElement`.
3. **Mixed Content**: Target `http://` di dalam aplikasi `https://`.
4. **Hambatan SPA & Sesi Autentikasi**: Cookie sesi (`HttpOnly`, `Domain`, `SameSite`), header CSRF (`Origin`/`Referer`/`X-CSRF-Token`), dynamic `import()`, Web Worker, dan WebSocket gagal tanpa rewriting penuh atau Service Worker terisolasi.
5. **Navigasi Keluar, Pop-up & Hotlink**: Link `target="_blank"`, overlay iklan transparan, serta penolakan aset tanpa `Referer` yang valid.

---

## 2. Alur Dua Mode di Tab Web (`resolveProxyWebViewState`)

- **Sumber**: `src/utils/web-view-policy.ts`, `src/hooks/use-engine-sw.ts`, `src/pages/hasil-pencarian/web/tab-web.tsx`, `src/pages/hasil-pencarian/web/use-web-frame.ts`.
1. Setelah validasi SSRF & rantai redirect pada `/api/inspect` selesai (`server/routes/inspect-route.ts` + `server/services/redirect-inspector.ts`), `TabWeb` menentukan rute pratinjau:
   - **Konten non-HTML** (gambar, PDF, video, audio, font, teks/JSON/JS/CSS) tetap memakai `WebDirectAssetView` melalui `/api/asset`.
   - **Halaman HTML** secara default dibuka pada **Mode Engine** (`/p/#<encodedTargetUrl>`).
2. **Registrasi Service Worker Induk (`use-engine-sw.ts`)**:
   - Service Worker `/p/sw.js` **wajib** didaftarkan dari dokumen induk (`navigator.serviceWorker.register('/p/sw.js', { scope: '/p/' })`) sebelum `<iframe src="/p/#...">` dimuat agar worker siap di `reg.active` dan tidak memicu kegagalan registrasi bersarang di dalam frame.
3. **Auto-Fallback ke Mode Ringan (`cdnfree:engine-fallback:v1`)**:
   - Setiap kegagalan dokumen di Mode Engine dicatat ke `localStorage` pada key `cdnfree:engine-fallback:v1` per hostname.
   - Jika suatu host mengalami **2× kegagalan Engine** (`ENGINE_FAILURE_THRESHOLD = 2`), CDNFREE otomatis beralih ke **Mode Ringan** (`/api/proxy`) untuk host tersebut dan menyediakan tombol manual **Mode Engine | Mode Ringan** di toolbar.
   - Jika halaman adalah domain `x.com` / `twitter.com` dan mengalami pemblokiran bot/halaman kosong, UI menampilkan informasi alternatif integrasi resmi `publish.twitter.com/oembed` dan `platform.twitter.com/widgets.js`.

---

## 3. Arsitektur Mode Engine — Scramjet 2.x + Wisp + Libcurl (`/p/` & `/wisp/`)

- **Isolasi Origin COOP / COEP**:
  - `server/app.ts` memasang header `Cross-Origin-Opener-Policy: same-origin` dan **`Cross-Origin-Embedder-Policy: credentialless`** (bukan `require-corp`) khusus pada route `/search`, `/hasil-pencarian`, dan `/p/` agar SharedArrayBuffer / WASM Scramjet dan aset lintas-asal tetap berjalan.
- **Mount Statis Engine (`/p/*`)** (`server/app.ts`):
  - `/p/scram/` -> `@mercuryworkshop/scramjet`
  - `/p/controller/` -> `@mercuryworkshop/scramjet-controller`
  - `/p/utils/` -> `@mercuryworkshop/scramjet-utils`
  - `/p/libcurl/` -> `@mercuryworkshop/libcurl-transport`
  - `/p/` -> `public/proxy/` (dengan `Service-Worker-Allowed: /p/` pada `/p/sw.js`).
- **Transport Wisp WebSocket (`/wisp/`)** (`server/wisp.ts` & `server.ts`):
  - Endpoint WebSocket `/wisp/` ditangani oleh `@mercuryworkshop/wisp-js/server` (`wispServer.routeRequest`) saat `httpServer.on('upgrade', ...)`.
  - **Hardening anti-SSRF Wisp**: `allow_private_ips: false`, `allow_loopback_ips: false`, `allow_direct_ip: false`, `port_whitelist: [80, 443]`, `dns_result_order: 'ipv4first'`.
- **Konfigurasi Controller & Plugin (`public/proxy/index.html`)**:
  - Memuat urutan skrip wajib: `scramjet.js` -> `controller.api.js` -> `scramjet-utils.js` -> ES module `LibcurlClient`.
  - Mengatur `config.prefix: '/p/sj/'` agar seluruh URL proxy tetap berada di dalam cakupan Service Worker `/p/`.
  - Memakai pemanggilan sinkron `frame.go(target)` (tanpa `await`).
  - Memasang plugin:
    - `HttpCachePlugin` & `UrlWatcherPlugin` (sinkronisasi URL aktif via `postMessage` `cdnfree:url`).
    - `CatchEscapedLinksPlugin` (menangkap navigasi `destination === "document"` yang lolos dan menjaga tetap di `/p/#...`, menggantikan `extbypass` DIY di Mode Engine).
    - `FingerprintMaskPlugin`: menyamarkan global wrapper Scramjet (`scramjetConfig.globals` ke prefix `__cf_*`) serta memindahkan/menghapus properti `window.$scramjet` dan `window.$scramjetController` setelah `hooks.init.post`.
    - `AssetObserverPlugin`: menyadap permintaan `image`/`video`/`audio`/`font` yang berhasil lewat `hooks.fetch.intercept` dan mengirimkannya ke induk via `cdnfree:asset` untuk memperkaya Tab Aset tanpa menyentuh `iframe.contentDocument`.
- **Batasan Strict Separation Mode Engine**:
  - `<iframe src="/p/#...">` dirender **tanpa** atribut `sandbox` agar Storage, Worker, Service Worker, Crypto, dan History target berjalan penuh.
  - Tidak ada `shim.ts`, tidak ada anti-clickjacking DIY, tidak ada popup blocker DIY, dan tidak ada `ResizeObserver` / pembacaan `iframe.contentDocument` pada Mode Engine.

---

## 4. Arsitektur Mode Ringan — Reverse Proxy & Rewriting (`/api/proxy` & `/api/asset`)

Mode Ringan melayani fallback cepat dan inspeksi struktural tanpa membutuhkan Service Worker:
1. **Safe Proxy Fetch + Session Cookie Jar** (`server/services/proxy/safe-proxy-fetch.ts`, `cookie-jar.ts`, `proxy-request-helpers.ts`):
   - Mendukung `GET`, `HEAD`, `POST`, `PUT`, `PATCH` dengan body maksimal `128 KB` serta penerusan aman `Content-Type`, `Origin`, `Referer`, `X-CSRF-Token`, dan `X-Twitter-Auth-Type`.
   - `SessionCookieJarStore` menyimpan `Set-Cookie` per `(sid, host)` secara efemeral di memori (berlaku 30 menit, maks 200 sesi), mengirimkan ulang cookie yang cocok per hop redirect, dan menulis ulang `Set-Cookie` ke respons browser (`Path=/api/proxy`, menghapus `Domain`/`Secure`).
2. **HTML/CSS/ESM/HLS Rewriting** (`server/services/proxy/rewrite.ts`):
   - Mem-parse HTML dengan `cheerio` (`mode: 'light'`), menghapus `Content-Security-Policy`, `X-Frame-Options`, SRI (`integrity`), `<base>`, serta menuliskan ulang aset ke `/api/asset` dan tautan/form ke `/api/proxy`.
   - Menyediakan `rewriteHtmlDocumentWithStats` dan endpoint diagnostik **`GET /api/proxy?u=...&debug=1`** yang mengembalikan JSON terstruktur: `{ upstreamStatus, upstreamMime, finalUrl, rewritten: { links, assets }, warnings, durationMs }`.
3. **Runtime Shim & Anti-Hijacking (`shim.ts`, `shim-anti-jack.ts`)**:
   - Hanya disuntikkan pada `mode === 'light'`.
   - Membypass frame-busting (`top`/`parent`/`frameElement`), menangkap tautan eksternal (`extbypass=1`), menetralkan popup `window.open`, melumpuhkan overlay transparan *clickjacking*, serta memproksi `fetch`/`XHR`/`history`/`DOM` ke `/api/asset` & `/api/proxy`.
4. **Ketahanan `/api/asset` (`proxy-route.ts`, `asset-route-helpers.ts`)**:
   - Retry otomatis tanpa `Referer` jika CDN menolak `401/403/406`.
   - Mendukung `HTTP 206 Partial Content` untuk video/audio/PDF dan sanitasi SVG (`svg-sanitizer.ts`).
   - Memeriksa header `Sec-Fetch-Dest`: respons HTML pada permintaan aset media (`image`/`video`/`audio`/`font`) tetap ditolak `502` agar tidak merusak kartu gambar, namun permintaan `Sec-Fetch-Dest: script` atau `empty` tidak pernah dipaksakan menjadi `502`.

---

## 5. Daftar Source & Package yang Digunakan

### 5.1 Source Code Utama
- **Server, Engine & Wisp**:
  - `server.ts` — Entry Express + Vite middleware + `attachWispUpgradeHandler` untuk `/wisp/`.
  - `server/app.ts` — Header COOP/COEP (`credentialless`), mount statis `/p/*`, bypass `express.json` pada `/api/proxy`.
  - `server/wisp.ts` — Konfigurasi `@mercuryworkshop/wisp-js/server` anti-SSRF & router upgrade WebSocket `/wisp/`.
  - `public/proxy/sw.js` & `public/proxy/index.html` — Service Worker & boot controller Scramjet 2.x + plugin (`FingerprintMaskPlugin`, `AssetObserverPlugin`, `CatchEscapedLinksPlugin`).
- **Server Mode Ringan Proxy & Keamanan**:
  - `server/routes/proxy-route.ts`, `server/services/proxy/proxy-request-helpers.ts`, `asset-route-helpers.ts`
  - `server/services/proxy/safe-proxy-fetch.ts`, `cookie-jar.ts`, `frame.ts`, `rewrite.ts`, `shim.ts`, `shim-anti-jack.ts`, `urlcodec.ts`, `stream-response.ts`, `captured-store.ts`, `svg-sanitizer.ts`
- **Frontend Tab Web**:
  - `src/utils/web-view-policy.ts` — Policy Engine vs Ringan, pelacak kegagalan `cdnfree:engine-fallback:v1`, helper `oembed` X.com.
  - `src/hooks/use-engine-sw.ts` — Registrasi parent Service Worker `/p/sw.js`.
  - `src/pages/hasil-pencarian/web/tab-web.tsx`, `use-web-frame.ts`, `collect-frame-sources.ts`, `web-fallback-card.tsx`, `web-direct-asset-view.tsx`, `web-bypass-toast.tsx`.

### 5.2 Daftar Package (`package.json`)

| Package | Versi (`package.json`) | Peran pada Mekanisme Web & Aset |
|---|---|---|
| `@mercuryworkshop/scramjet` | `2.0.67-alpha.2` | Core URL rewriter & runtime WASM untuk Mode Engine browser-in-browser. |
| `@mercuryworkshop/scramjet-controller` | `0.0.14` | Manajemen frame, Service Worker RPC (`controller.sw.js`), dan sistem plugin Scramjet 2.x. |
| `@mercuryworkshop/scramjet-utils` | `0.0.3` | Plugin `HttpCachePlugin`, `UrlWatcherPlugin`, dan `CatchEscapedLinksPlugin`. |
| `@mercuryworkshop/libcurl-transport` | `^2` | Transport TLS/HTTP sisi browser di atas koneksi Wisp WebSocket. |
| `@mercuryworkshop/wisp-js` | `^0.5.3` | Server WebSocket Wisp (`/wisp/`) untuk menyalurkan lalu lintas Mode Engine secara aman tanpa private IP. |
| `express` | `^4.21.2` | Server HTTP, mount statis `/p/*`, router `/api/proxy`, `/api/asset`, `/api/inspect`, `/api/stream`, `/api/download`. |
| `cheerio` | `^1.2.0` | Parser DOM HTML sisi server untuk Mode Ringan (`mode: 'light'`), ekstraktor aset statis, dan statistik diagnostik. |
| `compression` | `^1.8.2` | Kompresi respons HTTP server (`shouldCompressResponse`). |
| `zod` | `^4.6.7` | Validasi skema payload request/filter inspeksi. |
| `p-limit` | `^7.3.3` | Pembatasan konkurensi pemindaian aset sekunder (`deep-asset-scanner.ts`). |
| `pdfjs-dist` | `^6.5.438` | Rendering & pratinjau berkas PDF langsung di aplikasi. |
| `react`, `react-dom`, `react-router-dom` | `^19.0.1` / `^7.18.5` | Antarmuka `TabWeb`, toolbar Mode Engine/Ringan, navigasi tab, galeri aset, dan Full View. |
| `lucide-react`, `motion` | `^0.546.0` / `^12.23.24` | Ikon UI & animasi transisi ringan. |
| `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite` | `^8.3.0` / `^6.1.1` / `^4.3.3` | Bundler SPA & styling antarmuka aplikasi. |
| `tsx`, `typescript` | `^4.21.0` / `^7.0.2` | Eksekusi TypeScript server, runner pengujian `tsx --test`, dan pemeriksaan tipe. |

---

## 6. Batasan Teknis yang Jujur

1. **Konten Berlangganan / DRM**: Video atau siaran berbayar dengan enkripsi DRM (EME) tidak dapat diputar.
2. **Deteksi Bot / Captcha Ketat**: Situs dengan tantangan bot interaktif tingkat lanjut (seperti Cloudflare Turnstile/JS Challenge atau Arkose Captcha pada login tertentu) tetap dapat menolak akses.
3. **Fallback Otomatis**: Apabila Mode Engine gagal 2× pada host yang sama, CDNFREE secara otomatis menyimpan status tersebut per host di `cdnfree:engine-fallback:v1` dan beralih ke Mode Ringan atau menawarkan tautan buka langsung di tab baru.
