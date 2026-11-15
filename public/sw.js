/* CDNFREE Root Service Worker — App Shell Offline + SmartCache 206 Range Synthesizer */
'use strict';

const SHELL_CACHE = 'cdnfree-app-shell-v1';
const MEDIA_CACHE = 'cdnfree-smartcache-media-v1';
const DB_NAME = 'cdnfree-smartcache-db';
const DB_VERSION = 1;
const ENTRIES_STORE = 'entries';
const URLMAP_STORE = 'urlMap';
const OPFS_DIR = 'smartcache';
const PRECACHE_SHELL_URLS = ['/', '/logo.webp', '/favicon.svg'];
const MAX_LOCAL_MEDIA_PRECACHE_BYTES = 25 * 1024 * 1024;
const localPrecacheInFlight = new Set();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_SHELL_URLS.map(async (url) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok && res.status === 200) {
            await cache.put(url, res);
          }
        }),
      );
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key.startsWith('cdnfree-app-shell-') && key !== SHELL_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

function openDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
          db.createObjectStore(ENTRIES_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(URLMAP_STORE)) {
          db.createObjectStore(URLMAP_STORE, { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('posters')) {
          db.createObjectStore('posters', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getSmartCacheEntry(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ENTRIES_STORE, 'readonly');
      const req = tx.objectStore(ENTRIES_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function lookupKeyByUrl(pathWithQuery, fullHref) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(URLMAP_STORE, 'readonly');
      const store = tx.objectStore(URLMAP_STORE);
      const req1 = store.get(pathWithQuery);
      req1.onsuccess = () => {
        if (req1.result && req1.result.key) {
          resolve(req1.result.key);
          return;
        }
        const req2 = store.get(fullHref);
        req2.onsuccess = () => resolve(req2.result ? req2.result.key : null);
        req2.onerror = () => resolve(null);
      };
      req1.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function touchEntryAccess(key) {
  openDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry) {
          entry.lastAccessedAt = Date.now();
          store.put(entry);
        }
      };
    } catch {
      // Ignore background LRU touch failures
    }
  });
}

function parseByteRange(rangeHeader, totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return rangeHeader ? { type: 'unsatisfiable', totalBytes: 0 } : { type: 'full' };
  }
  if (!rangeHeader || !rangeHeader.trim()) {
    return { type: 'full' };
  }
  const match = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return { type: 'unsatisfiable', totalBytes };

  const rawStart = match[1] || '';
  const rawEnd = match[2] || '';
  if (rawStart === '' && rawEnd === '') {
    return { type: 'unsatisfiable', totalBytes };
  }

  let start;
  let end;
  if (rawStart === '') {
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

function synthesizeRangeResponse(blob, mimeType, request) {
  const totalBytes = blob.size;
  const rangeHeader = request.headers.get('range');
  const parsed = parseByteRange(rangeHeader, totalBytes);
  const safeMime = mimeType || blob.type || 'video/mp4';
  const isHead = request.method === 'HEAD';

  if (parsed.type === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: {
        'Content-Range': `bytes */${totalBytes}`,
        'Accept-Ranges': 'bytes',
        'X-CDNFREE-Cache': 'HIT',
      },
    });
  }

  if (parsed.type === 'partial') {
    const sliced = blob.slice(parsed.start, parsed.end + 1, safeMime);
    return new Response(isHead ? null : sliced, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': safeMime,
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalBytes}`,
        'Content-Length': String(sliced.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=31536000',
        'X-CDNFREE-Cache': 'HIT',
      },
    });
  }

  return new Response(isHead ? null : blob, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': safeMime,
      'Content-Length': String(totalBytes),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=31536000',
      'X-CDNFREE-Cache': 'HIT',
    },
  });
}

async function readOpfsBlob(key) {
  if (!self.navigator?.storage?.getDirectory) return null;
  try {
    const root = await self.navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: false });
    const fileHandle = await dir.getFileHandle(`${key}.bin`, { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

async function serveSmartCacheMediaByKey(key, request) {
  const entry = await getSmartCacheEntry(key);
  if (!entry || entry.status !== 'complete') {
    return null;
  }

  let blob = null;
  if (entry.storageBackend === 'opfs') {
    blob = await readOpfsBlob(key);
  }
  if (!blob) {
    const cache = await caches.open(MEDIA_CACHE);
    const cached = await cache.match(`/smartcache/v1/media?key=${encodeURIComponent(key)}`);
    if (cached) {
      blob = await cached.blob();
    }
  }
  if (!blob || blob.size === 0) return null;

  touchEntryAccess(key);
  return synthesizeRangeResponse(blob, entry.mimeType, request);
}

async function serveSmartCacheHlsPath(pathname) {
  const cache = await caches.open(MEDIA_CACHE);
  const matched = await cache.match(pathname);
  if (!matched) {
    return new Response('SmartCache HLS item not found', { status: 404 });
  }
  return matched;
}

function shouldBypassServiceWorker(url, request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return true;
  if (url.origin !== self.location.origin) return true;

  const p = url.pathname;
  // Never interfere with Scramjet Engine SW (/p/) or WebSocket/Wisp or dynamic inspect/proxy APIs
  if (
    p.startsWith('/p/') ||
    p === '/p' ||
    p.startsWith('/wisp/') ||
    p.startsWith('/api/proxy') ||
    p.startsWith('/api/inspect') ||
    p.startsWith('/api/filters') ||
    p.startsWith('/api/health') ||
    p.startsWith('/api/captured') ||
    p.startsWith('/api/download') ||
    p === '/view' ||
    p === '/sw.js'
  ) {
    return true;
  }

  // Never cache Vite dev server virtual modules
  if (
    p.startsWith('/@vite/') ||
    p.startsWith('/@react-refresh') ||
    p.startsWith('/@fs/') ||
    p.startsWith('/src/') ||
    p.startsWith('/node_modules/')
  ) {
    return true;
  }

  return false;
}

function backgroundCacheLocalMedia(urlPath) {
  if (localPrecacheInFlight.has(urlPath)) return;
  localPrecacheInFlight.add(urlPath);
  fetch(urlPath, { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok || res.status !== 200) return;
      const len = Number(res.headers.get('content-length') || '0');
      if (len > MAX_LOCAL_MEDIA_PRECACHE_BYTES) return;
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(urlPath, res);
    })
    .catch(() => {})
    .finally(() => {
      localPrecacheInFlight.delete(urlPath);
    });
}

async function handleAppShellNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const networkRes = await fetch(request);
    if (networkRes.ok && networkRes.status === 200) {
      cache.put('/', networkRes.clone()).catch(() => {});
    }
    return networkRes;
  } catch {
    const cachedRoot = await cache.match('/');
    if (cachedRoot) return cachedRoot;
    return new Response('Aplikasi sedang offline dan cache halaman belum tersedia.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function handleStaticAssetRequest(url, request) {
  const cache = await caches.open(SHELL_CACHE);
  const isMediaExt = /\.(mp4|m4v|webm|ogv|ogg|mov)$/i.test(url.pathname);
  const hasRange = request.headers.has('range');

  if (isMediaExt) {
    const cachedFull = await cache.match(url.pathname);
    if (cachedFull && cachedFull.status === 200) {
      const blob = await cachedFull.blob();
      return synthesizeRangeResponse(
        blob,
        cachedFull.headers.get('content-type') || 'video/mp4',
        request,
      );
    }
    if (hasRange) {
      backgroundCacheLocalMedia(url.pathname);
      return fetch(request);
    }
  }

  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const networkRes = await fetch(request);
  if (networkRes.ok && networkRes.status === 200 && request.method === 'GET') {
    cache.put(request, networkRes.clone()).catch(() => {});
  }
  return networkRes;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassServiceWorker(url, request)) {
    return;
  }

  // 1. Virtual SmartCache Media URL (/smartcache/v1/media?key=...)
  if (url.pathname === '/smartcache/v1/media') {
    const key = url.searchParams.get('key');
    event.respondWith(
      (async () => {
        if (!key) return new Response('Missing key', { status: 400 });
        const hit = await serveSmartCacheMediaByKey(key, request);
        return hit || new Response('SmartCache miss', { status: 404 });
      })(),
    );
    return;
  }

  // 2. Virtual SmartCache HLS manifest & segments (/smartcache/v1/hls/<key>/...)
  if (url.pathname.startsWith('/smartcache/v1/hls/')) {
    event.respondWith(serveSmartCacheHlsPath(url.pathname));
    return;
  }

  // 3. Intercept /api/assets/stream/*, /api/asset?*, /api/hls/* if mapped in SmartCache
  if (
    url.pathname.startsWith('/api/assets/stream/') ||
    url.pathname === '/api/asset' ||
    url.pathname.startsWith('/api/hls/')
  ) {
    event.respondWith(
      (async () => {
        const pathWithQuery = `${url.pathname}${url.search}`;
        const mappedKey = await lookupKeyByUrl(pathWithQuery, url.href);
        if (mappedKey) {
          const entry = await getSmartCacheEntry(mappedKey);
          if (entry && entry.status === 'complete') {
            if (entry.kind === 'hls' && url.pathname.startsWith('/api/hls/') && !url.searchParams.has('u')) {
              return serveSmartCacheHlsPath(
                `/smartcache/v1/hls/${encodeURIComponent(mappedKey)}/index.m3u8`,
              );
            }
            if (entry.kind === 'video') {
              const hit = await serveSmartCacheMediaByKey(mappedKey, request);
              if (hit) return hit;
            }
          }
        }
        return fetch(request);
      })(),
    );
    return;
  }

  // 4. App Shell Navigation (Network-First + Offline Fallback to cached '/')
  if (request.mode === 'navigate') {
    event.respondWith(handleAppShellNavigation(request));
    return;
  }

  // 5. Built static assets (/assets/*, /logo.webp, /favicon.svg)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/logo.webp' ||
    url.pathname === '/favicon.svg'
  ) {
    event.respondWith(handleStaticAssetRequest(url, request));
  }
});
