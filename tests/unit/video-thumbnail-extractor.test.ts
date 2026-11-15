import test from 'node:test';
import assert from 'node:assert/strict';
import { drawVideoFrameToDataUrl } from '../../src/utils/video-thumbnail-extractor.ts';

function withMockDocument<T>(
  toDataUrlImpl: () => string,
  fn: () => T,
): T {
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
        }),
        toDataURL: toDataUrlImpl,
      };
    },
  };
  try {
    return fn();
  } finally {
    if (prevDoc === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document: unknown }).document = prevDoc;
    }
  }
}

test('drawVideoFrameToDataUrl rejects unready or zero-dimension video elements', () => {
  withMockDocument(
    () => 'data:image/jpeg;base64,' + 'A'.repeat(120),
    () => {
      assert.deepEqual(
        drawVideoFrameToDataUrl({ readyState: 1, videoWidth: 1280, videoHeight: 720 }),
        { ok: false, reason: 'not-ready' },
      );
      assert.deepEqual(
        drawVideoFrameToDataUrl({ readyState: 3, videoWidth: 0, videoHeight: 720 }),
        { ok: false, reason: 'not-ready' },
      );
    },
  );
});

test('drawVideoFrameToDataUrl flags CORS-tainted canvas SecurityError cleanly for proxy fallback', () => {
  const securityErr = new Error('Tainted canvases may not be exported.');
  securityErr.name = 'SecurityError';

  withMockDocument(
    () => {
      throw securityErr;
    },
    () => {
      assert.deepEqual(
        drawVideoFrameToDataUrl({ readyState: 3, videoWidth: 1280, videoHeight: 720 }),
        { ok: false, reason: 'tainted' },
      );
    },
  );
});

test('drawVideoFrameToDataUrl returns JPEG dataUrl when video frame is readable', () => {
  const sampleDataUrl = `data:image/jpeg;base64,${'A'.repeat(160)}`;
  withMockDocument(
    () => sampleDataUrl,
    () => {
      assert.deepEqual(
        drawVideoFrameToDataUrl({ readyState: 4, videoWidth: 1920, videoHeight: 1080 }),
        { ok: true, dataUrl: sampleDataUrl },
      );
    },
  );
});
