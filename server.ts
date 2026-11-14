import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApiApp, shouldCompressResponse } from './server/app.ts';

export { createApiApp, shouldCompressResponse };

async function startServer() {
  const app = createApiApp();
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(port, '0.0.0.0', () => {
    console.log(`CDNFREE server listening on http://0.0.0.0:${port}`);
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
