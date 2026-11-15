import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitiveParamName, redactUrlForDisplay } from '../../src/utils/redact-url';

test('isSensitiveParamName flags secret-like query parameter names', () => {
  assert.equal(isSensitiveParamName('token'), true);
  assert.equal(isSensitiveParamName('access_token'), true);
  assert.equal(isSensitiveParamName('apiKey'), true);
  assert.equal(isSensitiveParamName('session_id'), true);
  assert.equal(isSensitiveParamName('auth'), true);
  assert.equal(isSensitiveParamName('page'), false);
  assert.equal(isSensitiveParamName('q'), false);
});

test('redactUrlForDisplay masks sensitive query parameters and keeps safe params', () => {
  const redacted = redactUrlForDisplay(
    'https://example.com/download?file=video.mp4&token=secret123&api_key=abc&page=2',
  );
  assert.equal(
    redacted,
    'https://example.com/download?file=video.mp4&token=REDACTED&api_key=REDACTED&page=2',
  );
});
