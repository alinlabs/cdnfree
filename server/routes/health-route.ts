import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'cdnfree-inspector',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
