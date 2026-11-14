import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInspectionById,
  submitInspectionRequest,
} from '../../src/services/inspection-service.ts';
import { downloadInspectedAsset } from '../../src/services/download-service.ts';
import { getAssetDownloadEligibility } from '../../src/utils/safe-external-url.ts';

test('submitInspectionRequest and getInspectionById reject malformed JSON and invalid schemas cleanly', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Invalid JSON despite application/json header returns SERVER_ERROR (not NETWORK_ERROR)
    globalThis.fetch = (async () =>
      new Response('{corrupt-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const malformed = await submitInspectionRequest({ url: 'https://example.com/' });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.error.code, 'SERVER_ERROR');
      assert.match(malformed.error.message, /JSON/i);
    }

    // 2. Valid JSON failing InspectionResultSchema validation is rejected safely
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'x', unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const schemaMismatch = await getInspectionById('11111111-1111-4111-8111-111111111111');
    assert.equal(schemaMismatch.ok, false);
    if (!schemaMismatch.ok) {
      assert.equal(schemaMismatch.error.code, 'SERVER_ERROR');
    }

    // 3. Aborted request maps cleanly to ABORTED without unhandled rejection
    const controller = new AbortController();
    globalThis.fetch = (async (_url, init) => {
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw new DOMException('Aborted', 'AbortError');
    }) as typeof fetch;
    controller.abort();

    const aborted = await submitInspectionRequest(
      { url: 'https://example.com/' },
      controller.signal,
    );
    assert.equal(aborted.ok, false);
    if (!aborted.ok) {
      assert.equal(aborted.error.code, 'ABORTED');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('downloadInspectedAsset rejects unexpected HTML 200 responses and corrupt JSON error payloads', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response('<html>error page</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })) as typeof fetch;

    const htmlOutcome = await downloadInspectedAsset('insp-1', 'res-1');
    assert.equal(htmlOutcome.ok, false);
    if (!htmlOutcome.ok) {
      assert.match(htmlOutcome.message, /HTML/i);
    }

    globalThis.fetch = (async () =>
      new Response('{broken', {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const badJsonOutcome = await downloadInspectedAsset('insp-1', 'res-1');
    assert.equal(badJsonOutcome.ok, false);
    if (!badJsonOutcome.ok) {
      assert.match(badJsonOutcome.message, /tidak dapat dibaca/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getAssetDownloadEligibility blocks private IP and localhost resource URLs', () => {
  const localResource = {
    id: 'res-local',
    url: 'http://127.0.0.1:8080/internal.png',
    host: '127.0.0.1',
    kind: 'image' as const,
    source: 'html-img' as const,
    observation: 'discovered' as const,
    classification: 'allowed' as const,
  };
  assert.equal(getAssetDownloadEligibility(localResource).eligible, false);
});
