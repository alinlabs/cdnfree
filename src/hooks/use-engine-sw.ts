import { useCallback, useEffect, useState } from 'react';

export type EngineSwStatus = 'idle' | 'registering' | 'ready' | 'error';

function waitForWorkerActivation(reg: ServiceWorkerRegistration): Promise<boolean> {
  if (reg.active) return Promise.resolve(true);
  const worker = reg.installing || reg.waiting;
  if (!worker) return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      worker.removeEventListener('statechange', onStateChange);
      resolve(Boolean(reg.active));
    }, 8_000);

    const onStateChange = () => {
      if (worker.state === 'activated' || reg.active) {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', onStateChange);
        resolve(true);
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', onStateChange);
        resolve(false);
      }
    };

    worker.addEventListener('statechange', onStateChange);
  });
}

export function useEngineServiceWorker(enabled: boolean) {
  const [status, setStatus] = useState<EngineSwStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ensureReady = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      setStatus('error');
      setErrorMessage('Peramban tidak mendukung Service Worker untuk Mode Engine.');
      return false;
    }

    setStatus((prev) => (prev === 'ready' ? 'ready' : 'registering'));
    setErrorMessage(null);

    try {
      const existing = await navigator.serviceWorker.getRegistration('/p/');
      if (existing?.active) {
        setStatus('ready');
        return true;
      }

      const registration = await navigator.serviceWorker.register('/p/sw.js', {
        scope: '/p/',
      });
      const active = await waitForWorkerActivation(registration);
      if (!active) {
        setStatus('error');
        setErrorMessage('Service Worker Engine gagal aktif di scope /p/.');
        return false;
      }
      setStatus('ready');
      return true;
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal mendaftarkan Service Worker Engine.',
      );
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void ensureReady().then((ok) => {
      if (cancelled && !ok) return;
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ensureReady]);

  return { status, errorMessage, ensureReady };
}
