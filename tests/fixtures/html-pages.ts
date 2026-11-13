export const ORDINARY_HTML_FIXTURE = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Portal Berita Contoh</title>
    <meta name="description" content="Artikel berita teknologi dan keamanan web." />
    <link rel="canonical" href="https://portal.example/berita/utama" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="stylesheet" href="https://d1234.cloudfront.net/styles/main.css" />
    <link rel="preload" as="font" href="https://fonts.gstatic.com/s/inter/v1/inter.woff2" />
    <script src="https://cdn.jsdelivr.net/npm/app@1.0.0/dist/index.js"></script>
    <script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
  </head>
  <body>
    <img src="/images/hero.webp" srcset="/images/hero-2x.webp 2x" alt="Hero" />
    <a href="/tentang">Tentang Kami</a>
    <a href="https://mitra.example.org/artikel">Baca mitra</a>
  </body>
</html>`;

export const BASE_AND_MEDIA_FIXTURE = `<!doctype html>
<html>
  <head>
    <base href="https://static.example.com/assets/" />
    <title>Galeri Media</title>
    <meta http-equiv="refresh" content="5;url=https://next.example.com/landing" />
  </head>
  <body>
    <picture>
      <source srcset="images/cover.avif 1x, images/cover-2x.avif 2x" type="image/avif" />
      <img src="images/cover.jpg" alt="Cover" />
    </picture>
    <video poster="posters/intro.png" controls>
      <source src="videos/intro.mp4" type="video/mp4" />
    </video>
    <audio controls>
      <source src="audio/podcast.mp3" type="audio/mpeg" />
    </audio>
    <a href="halaman-dua.html">Lanjut</a>
  </body>
</html>`;

export const MALFORMED_AND_UNSAFE_FIXTURE = `
<html><head><title>  Halaman   Tidak   Rapi </title>
<meta name="description" content="Deskripsi tetap terbaca">
<meta http-equiv="refresh" content="0;url=javascript:alert(1)">
<body><div class=unquoted>
  <img src="javascript:alert(1)" />
  <img src="data:image/svg+xml,<svg></svg>" />
  <script src="file:///etc/passwd"></script>
  <script>window.__inlineExecuted = true;</script>
  <a href="https://phish-target.example/login">https://bank-resmi.example/login</a>
  <a href="https://bit.ly/3demo">Tautan singkat</a>
  <a href="https://thirdparty.example/go?redirect=https://other.example">Download Now</a>
  <a href="javascript:void(0)">Klik aman palsu</a>
  <a href="https://cdn.example.net/doc.pdf">Dokumen CDN biasa</a>
  <img src="https://media.example.com/assets/photo.png" />
  <img src="https://media.example.com/assets/photo.png" />
`;
