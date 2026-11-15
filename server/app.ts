import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import compression from 'compression';
import express, { type Express, type Request, type Response } from 'express';
import {
  createDownloadRouter,
  type DownloadRouterDependencies,
} from './routes/download-route.ts';
import { createFiltersRouter } from './routes/filters-route.ts';
import { createHealthRouter } from './routes/health-route.ts';
import {
  createInspectRouter,
  type InspectRouterDependencies,
} from './routes/inspect-route.ts';
import {
  createProxyRouter,
  createViewRouter,
  type ProxyRouterDependencies,
} from './routes/proxy-route.ts';
import {
  createStreamRouter,
  type StreamRouterDependencies,
} from './routes/stream-route.ts';
import { setFrameable } from './services/proxy/frame.ts';
import type { FilterSourceManager } from './services/filter-source-manager.ts';

const requireFromHere = createRequire(import.meta.url);
const dirOf = (spec: string) => path.dirname(requireFromHere.resolve(spec));
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function shouldCompressResponse(req: Request, res: Response): boolean {
  if (req.method === 'HEAD' || req.headers.range || res.statusCode === 206) {
    return false;
  }
  const ct = res.getHeader('content-type');
  if (
    typeof ct === 'string' &&
    /^(video|audio|image|font)\//i.test(ct.trim())
  ) {
    return false;
  }
  return compression.filter(req, res);
}

export function createApiApp(
  inspectDeps?: InspectRouterDependencies,
  downloadDeps?: DownloadRouterDependencies,
  filterManager?: FilterSourceManager,
  proxyDeps?: ProxyRouterDependencies,
  streamDeps?: StreamRouterDependencies,
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression({ filter: shouldCompressResponse }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!req.path.startsWith('/api')) {
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
        setFrameable(res);
        return origWriteHead(...args);
      }) as typeof res.writeHead;
      setFrameable(res);
    }
    next();
  });

  app.use(['/search', '/hasil-pencarian', '/p/'], (_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });

  app.use('/p/scram/', express.static(scramjetPath));
  app.use('/p/utils/', express.static(dirOf('@mercuryworkshop/scramjet-utils')));
  app.use(
    '/p/controller/',
    express.static(dirOf('@mercuryworkshop/scramjet-controller')),
  );
  app.use(
    '/p/libcurl/',
    express.static(dirOf('@mercuryworkshop/libcurl-transport')),
  );
  app.use(
    '/p/',
    express.static(path.join(ROOT_DIR, 'public/proxy'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(`${path.sep}sw.js`)) {
          res.setHeader('Service-Worker-Allowed', '/p/');
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.use('/api', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const secFetchSite = req.get('sec-fetch-site')?.toLowerCase();
    if (req.method === 'POST' && secFetchSite === 'cross-site') {
      res.status(403).json({
        code: 'CROSS_SITE_REJECTED',
        message: 'Permintaan lintas situs ke API inspeksi ditolak.',
      });
      return;
    }
    next();
  });

  const jsonParser = express.json({ limit: '16kb' });
  app.use((req, res, next) => {
    if (req.path === '/api/proxy') {
      next();
      return;
    }
    jsonParser(req, res, next);
  });
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api') && err instanceof SyntaxError) {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        message: 'Isi permintaan JSON tidak valid.',
      });
      return;
    }
    if (
      req.path.startsWith('/api') &&
      err &&
      typeof err === 'object' &&
      (err as { type?: unknown }).type === 'entity.too.large'
    ) {
      res.status(413).json({
        code: 'RESPONSE_TOO_LARGE',
        message: 'Ukuran permintaan melebihi batas maksimum yang diizinkan.',
      });
      return;
    }
    next(err);
  });

  app.use('/api', createHealthRouter());
  app.use('/api', createFiltersRouter(filterManager));
  app.use(
    '/api',
    createInspectRouter(
      filterManager ? { ...inspectDeps, filterManager } : inspectDeps,
    ),
  );
  app.use('/api', createDownloadRouter(downloadDeps));
  app.use('/api', createStreamRouter(streamDeps));
  app.use('/api', createProxyRouter(proxyDeps));
  app.use('/', createViewRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({
      code: 'NOT_FOUND',
      message: 'Endpoint API tidak ditemukan.',
    });
  });

  return app;
}
