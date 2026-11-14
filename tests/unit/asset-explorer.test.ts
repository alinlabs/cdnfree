import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResourceRecord } from '../../src/types/inspection.ts';
import {
  classifyAssetGroup,
  deduplicateResources,
  evaluateAudioPreview,
  evaluateImagePreview,
  evaluatePdfPreview,
  evaluateVideoPreview,
  formatCompactAssetBadge,
  getAssetSectionVisibility,
  getImageFormatLabel,
  getInlineAssetPreviewKind,
  getVideoFormatLabel,
  isPdfResource,
  isSvgResource,
  shouldAttemptVideo,
} from '../../src/utils/asset-explorer.ts';

function makeResource(overrides: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: 'res-1',
    url: 'https://cdn.example.com/photo.png',
    host: 'cdn.example.com',
    kind: 'image',
    source: 'html-img',
    observation: 'discovered',
    classification: 'allowed',
    ...overrides,
  };
}

test('deduplicateResources merges exact/fragment-equivalent URLs and keeps richer metadata', () => {
  const lessDetailed = makeResource({
    id: 'res-a',
    url: 'https://cdn.example.com/banner.webp#hero',
    source: 'html-source',
    observation: 'unknown',
    mimeType: undefined,
  });

  const moreDetailed = makeResource({
    id: 'res-b',
    url: 'https://cdn.example.com/banner.webp',
    source: 'html-img',
    observation: 'discovered',
    mimeType: 'image/webp',
    declaredBytes: 42000,
  });

  const merged = deduplicateResources([lessDetailed, moreDetailed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'res-b');
  assert.equal(merged[0].mimeType, 'image/webp');
});

test('classifyAssetGroup respects trustworthy MIME metadata and preserves uncertainty on conflicts', () => {
  assert.equal(
    classifyAssetGroup(makeResource({ kind: 'image', mimeType: 'image/avif' })),
    'image',
  );
  assert.equal(
    classifyAssetGroup(makeResource({ kind: 'image', mimeType: undefined })),
    'image',
  );
  // Conflicting MIME: kind says image, MIME says text/html -> preserve uncertainty in 'other'
  assert.equal(
    classifyAssetGroup(makeResource({ kind: 'image', mimeType: 'text/html' })),
    'other',
  );
  assert.equal(
    classifyAssetGroup(
      makeResource({ kind: 'other', mimeType: 'video/mp4', url: 'https://cdn.example.com/stream' }),
    ),
    'video',
  );
  assert.equal(
    classifyAssetGroup(makeResource({ kind: 'script', mimeType: 'application/javascript' })),
    'other',
  );
});

test('evaluateImagePreview renders safe rasters and falls back for SVG, TIFF, blocked, tracker, mixed-content, and unsafe URLs', () => {
  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'https://cdn.example.com/photo.webp', mimeType: 'image/webp' }),
      'https:',
    ).status,
    'render-img',
  );

  // Missing MIME still attempts safe raster <img> with error fallback
  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'https://cdn.example.com/image?id=12', mimeType: undefined }),
      'https:',
    ).status,
    'render-img',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'https://cdn.example.com/logo.svg', mimeType: 'image/svg+xml' }),
      'https:',
    ).status,
    'render-img',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'https://cdn.example.com/scan.tiff', mimeType: 'image/tiff' }),
      'https:',
    ).status,
    'unsupported-format',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ classification: 'ad-or-tracker' }),
      'https:',
    ).status,
    'restricted',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ observation: 'blocked' }),
      'https:',
    ).status,
    'restricted',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'http://plain.example.com/pic.jpg' }),
      'https:',
    ).status,
    'mixed-content',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'javascript:alert(1)' }),
      'https:',
    ).status,
    'unsafe-url',
  );
});

test('shouldAttemptVideo and evaluateVideoPreview attempt video/* and octet-stream video extensions while rejecting manifests and unsafe URLs', () => {
  assert.equal(shouldAttemptVideo('video/mp4', 'https://cdn.example.com/clip.mp4'), true);
  assert.equal(shouldAttemptVideo('video/quicktime', 'https://cdn.example.com/clip.mov'), true);
  assert.equal(shouldAttemptVideo('video/x-matroska', 'https://cdn.example.com/clip.mkv'), true);
  assert.equal(
    shouldAttemptVideo('application/octet-stream', 'https://cdn.example.com/video.m4v'),
    true,
  );
  assert.equal(
    shouldAttemptVideo('', 'https://cdn.example.com/clip.mp4'),
    true,
  );
  assert.equal(
    shouldAttemptVideo('application/octet-stream', 'https://cdn.example.com/archive.bin'),
    false,
  );
  assert.equal(
    shouldAttemptVideo('application/vnd.apple.mpegurl', 'https://cdn.example.com/live/master.m3u8'),
    false,
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip.mp4',
        mimeType: 'video/mp4',
      }),
      'https:',
    ).status,
    'native-video',
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip.mov',
        mimeType: 'application/octet-stream',
      }),
      'https:',
    ).status,
    'native-video',
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip',
        mimeType: undefined,
      }),
      'https:',
    ).status,
    'unknown-mime',
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/live/master.m3u8',
        mimeType: 'application/vnd.apple.mpegurl',
      }),
      'https:',
    ).status,
    'unsupported-stream',
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip.mp4',
        mimeType: 'video/mp4',
        observation: 'blocked',
      }),
      'https:',
    ).status,
    'restricted',
  );
});

test('asset-explorer strips MIME parameters and blocks local/private host auto-previews', () => {
  assert.equal(
    evaluateImagePreview(
      makeResource({
        url: 'https://cdn.example.com/vector-asset',
        mimeType: 'image/svg+xml; charset=utf-8',
      }),
      'https:',
    ).status,
    'render-img',
  );

  assert.equal(
    classifyAssetGroup(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/stream',
        mimeType: 'application/vnd.apple.mpegurl; charset=utf-8',
      }),
    ),
    'video',
  );

  assert.equal(
    evaluateImagePreview(
      makeResource({ url: 'http://127.0.0.1:8080/internal.png' }),
      'http:',
    ).status,
    'restricted',
  );

  assert.equal(
    evaluateVideoPreview(
      makeResource({
        kind: 'video',
        url: 'http://localhost/internal.mp4',
        mimeType: 'video/mp4',
      }),
      'http:',
    ).status,
    'restricted',
  );
});

test('getAssetSectionVisibility keeps MIME-reclassified sections visible under narrow kind filters', () => {
  assert.deepEqual(
    getAssetSectionVisibility('image', { image: 0, video: 0, other: 1 }),
    { showImageSection: true, showVideoSection: false, showOtherSection: true },
  );
  assert.deepEqual(
    getAssetSectionVisibility('other', { image: 1, video: 0, other: 0 }),
    { showImageSection: true, showVideoSection: false, showOtherSection: true },
  );
  assert.deepEqual(
    getAssetSectionVisibility('image', { image: 2, video: 0, other: 0 }),
    { showImageSection: true, showVideoSection: false, showOtherSection: false },
  );
  assert.deepEqual(
    getAssetSectionVisibility('all', { image: 2, video: 0, other: 0 }, true),
    { showImageSection: true, showVideoSection: false, showOtherSection: false },
  );
});

test('asset-explorer classifies SVG, PDF, audio, font, and text preview formats accurately', () => {
  const svgRes = makeResource({
    url: 'https://cdn.example.com/brand-mark.svg',
    mimeType: 'image/svg+xml',
  });
  assert.equal(isSvgResource(svgRes), true);
  assert.equal(getImageFormatLabel(svgRes), 'SVG');
  assert.equal(getInlineAssetPreviewKind(svgRes), 'image');

  const pdfRes = makeResource({
    kind: 'document',
    url: 'https://cdn.example.com/brosur.pdf',
    mimeType: 'application/pdf',
  });
  assert.equal(isPdfResource(pdfRes), true);
  assert.equal(getInlineAssetPreviewKind(pdfRes), 'pdf');
  assert.equal(evaluatePdfPreview(pdfRes, 'https:').canRenderPdf, true);
  assert.equal(
    evaluatePdfPreview({ ...pdfRes, url: 'http://127.0.0.1/doc.pdf' }, 'http:').status,
    'restricted',
  );

  const audioRes = makeResource({
    kind: 'audio',
    url: 'https://cdn.example.com/clip.mp3',
    mimeType: 'audio/mpeg',
  });
  assert.equal(getInlineAssetPreviewKind(audioRes), 'audio');
  assert.equal(evaluateAudioPreview(audioRes, 'https:').canRenderAudio, true);

  const fontRes = makeResource({
    kind: 'font',
    url: 'https://cdn.example.com/inter.woff2',
    mimeType: 'font/woff2',
  });
  assert.equal(getInlineAssetPreviewKind(fontRes), 'font');

  const cssRes = makeResource({
    kind: 'stylesheet',
    url: 'https://cdn.example.com/main.css',
    mimeType: 'text/css',
  });
  assert.equal(getInlineAssetPreviewKind(cssRes), 'text');
});

test('getVideoFormatLabel and formatCompactAssetBadge format video types and optional byte weights cleanly', () => {
  assert.equal(
    getVideoFormatLabel(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/reel.mp4',
        mimeType: 'video/mp4',
      }),
    ),
    'MP4',
  );
  assert.equal(
    getVideoFormatLabel(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip',
        mimeType: 'video/webm; codecs="vp9"',
      }),
    ),
    'WEBM',
  );
  assert.equal(
    getVideoFormatLabel(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/live/master.m3u8',
        mimeType: 'application/vnd.apple.mpegurl',
      }),
    ),
    'HLS',
  );
  assert.equal(
    getVideoFormatLabel(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/clip.mov',
        mimeType: undefined,
      }),
    ),
    'MOV',
  );
  assert.equal(
    getVideoFormatLabel(
      makeResource({
        kind: 'video',
        url: 'https://cdn.example.com/stream',
        mimeType: undefined,
      }),
    ),
    'VIDEO',
  );

  assert.equal(formatCompactAssetBadge('SVG', 7987), 'SVG · 7,8 KB');
  assert.equal(formatCompactAssetBadge('MP4', 2516582), 'MP4 · 2,4 MB');
  assert.equal(formatCompactAssetBadge('PNG', 0), 'PNG · 0 B');
  assert.equal(formatCompactAssetBadge('ICO', undefined), 'ICO');
  assert.equal(formatCompactAssetBadge('MP4', null), 'MP4');
  assert.equal(formatCompactAssetBadge('MP4', -10), 'MP4');
});

test('deduplicateResources preserves posterUrl across richer and fallback video records', () => {
  const deduped = deduplicateResources([
    makeResource({
      id: 'vid-html',
      kind: 'video',
      url: 'https://cdn.example.com/clip.mp4',
      source: 'html-video',
      observation: 'discovered',
      posterUrl: 'https://cdn.example.com/thumb.jpg',
    }),
    makeResource({
      id: 'vid-fetched',
      kind: 'video',
      url: 'https://cdn.example.com/clip.mp4',
      source: 'browser-observed',
      observation: 'fetched',
      mimeType: 'video/mp4',
      declaredBytes: 4_000_000,
    }),
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].declaredBytes, 4_000_000);
  assert.equal(deduped[0].posterUrl, 'https://cdn.example.com/thumb.jpg');
});




