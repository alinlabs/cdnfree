import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Plugin } from 'vite';
import { createApiApp, shouldCompressResponse } from './server/app.ts';
import { attachWispUpgradeHandler } from './server/wisp.ts';

export { createApiApp, shouldCompressResponse };

function createDisableHmrClientWsPlugin(): Plugin {
  return {
    name: 'cdnfree-disable-hmr-client-ws',
    enforce: 'post',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/');
      if (
        normalized === '/@vite/client' ||
        normalized.endsWith('/vite/dist/client/client.mjs')
      ) {
        const patched = code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            'void handleMessage;',
          )
          .replace('console.debug("[vite] connecting...");', 'void 0;')
          .replace(
            /createConnection:\s*\(\)\s*=>\s*new WebSocket\([^)]*\)/g,
            'createConnection: () => ({ addEventListener() {}, removeEventListener() {}, send() {}, close() {} })',
          );
        return { code: patched, map: null };
      }
      return null;
    },
  };
}

async function startServer() {
  const app = createApiApp();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  const hmrEnabled =
    process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      plugins: hmrEnabled ? [] : [createDisableHmrClientWsPlugin()],
      server: {
        middlewareMode: true,
        hmr: hmrEnabled,
        ws: hmrEnabled ? undefined : false,
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(currentDir, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`CDNFREE server listening on http://0.0.0.0:${port}`);
  });
  attachWispUpgradeHandler(httpServer, {
    allowOtherUpgrades: !isProd && hmrEnabled,
  });
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  startServer().catch((err) => {
    console.error('Failed to start CDNFREE server:', err);
    process.exit(1);
  });
}
