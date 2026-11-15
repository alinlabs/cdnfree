import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUrlTarget } from '../../server/services/redirect-inspector.ts';
import type { DnsLookupFn } from '../../server/types/server.ts';
import type { FetchHopFn } from '../../server/services/safe-fetch.ts';
import type { ProbeFetchFn } from '../../server/services/asset-probe.ts';

const publicDns: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

const FAKE_MP4_FTYP = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
]);

test('eciemg pattern: 302 -> HTML wrapper on .mp4 -> harvests verified MP4 and marks wrapper unverified', async () => {
  const fetchHop: FetchHopFn = async (target) => {
    if (target.normalizedUrl === 'https://cdn2.eciemg.com/2llRtZ4T1.mp4') {
      return {
        kind: 'redirect',
        statusCode: 302,
        location: 'https://player.eciemg.com/watch/2llRtZ4T1.mp4',
        headers: { location: 'https://player.eciemg.com/watch/2llRtZ4T1.mp4' },
      };
    }
    return {
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      isWrapper: true,
      bodyText: `<!DOCTYPE html><html><body><video poster="https://cdn.dofiles.net/poster.jpg"><source src="https://assets.dofiles.net/on8fbxyp/629249485.mp4" type="video/mp4"></video></body></html>`,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    };
  };

  const fetchRange: ProbeFetchFn = async (url) => {
    if (url === 'https://assets.dofiles.net/on8fbxyp/629249485.mp4') {
      return {
        statusCode: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-2047/146681790',
          'accept-ranges': 'bytes',
        },
        buf: FAKE_MP4_FTYP,
      };
    }
    return {
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '12000' },
      buf: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    };
  };

  const r = await inspectUrlTarget('https://cdn2.eciemg.com/2llRtZ4T1.mp4', {
    dnsLookup: publicDns,
    fetchHop,
    fetchRange,
  });

  const media = r.resources.filter((x) => x.assetKind === 'video');
  assert.equal(media.length, 1);
  assert.equal(media[0].url, 'https://assets.dofiles.net/on8fbxyp/629249485.mp4');
  assert.equal(media[0].mimeType, 'video/mp4');
  assert.equal(media[0].declaredBytes, 146681790);
  assert.equal(media[0].probe?.status, 'verified');

  const wrappers = r.resources.filter((x) => x.assetKind === 'wrapper');
  assert.equal(wrappers.length, 1);
  assert.equal(wrappers[0].probe?.status, 'unverified');
  assert.equal(wrappers[0].probe?.reason, 'html-wrapper');
});

test('twimg.date pattern: HTML wrapper with custom div[src] / data-stream harvests verified MP4', async () => {
  const fetchHop: FetchHopFn = async () => ({
    kind: 'document',
    statusCode: 200,
    contentType: 'text/html',
    isWrapper: true,
    bodyText: `<!DOCTYPE html><html><body><div data-video-url="https://cdn2.videy.co/rl8CMBOC1.mp4"></div></body></html>`,
    headers: { 'content-type': 'text/html' },
  });

  const fetchRange: ProbeFetchFn = async () => ({
    statusCode: 206,
    headers: {
      'content-type': 'video/mp4',
      'content-range': 'bytes 0-2047/100718749',
      'accept-ranges': 'bytes',
    },
    buf: FAKE_MP4_FTYP,
  });

  const r = await inspectUrlTarget('https://media.twimg.date/rl8CMBOC1.mp4', {
    dnsLookup: publicDns,
    fetchHop,
    fetchRange,
  });

  const media = r.resources.filter((x) => x.assetKind === 'video');
  assert.equal(media.length, 1);
  assert.equal(media[0].url, 'https://cdn2.videy.co/rl8CMBOC1.mp4');
  assert.equal(media[0].declaredBytes, 100718749);
});

test('qceimg pattern: interstitial stub followed, then escaped HLS token decoded cleanly as first-class hls resource', async () => {
  const fetchHop: FetchHopFn = async (target) => {
    if (target.normalizedUrl === 'https://cdn2.qceimg.cc/ya2rghpbtx4.mp4') {
      return {
        kind: 'document',
        statusCode: 200,
        contentType: 'text/html',
        bodyText: `<html><head><script>window.location.replace("https://player.tvid.app/embed/ya2rghpbtx4");</script></head><body>Redirecting...</body></html>`,
        headers: { 'content-type': 'text/html' },
      };
    }
    return {
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html',
      bodyText: `<!DOCTYPE html><html><body>
        <div id="player" src="https://player.tvid.app/poster.jpg"></div>
        <script>
          window.__VX_BOOTSTRAP_VIDEO__ = {"hls":"https:\\/\\/api.tvid.app\\/v1\\/hls\\/master.m3u8\\u003ftoken\\u003dabc123\\u0026sess\\u003dxyz999"};
        </script>
      </body></html>`,
      headers: { 'content-type': 'text/html' },
    };
  };

  const fetchRange: ProbeFetchFn = async (url) => {
    if (url.includes('master.m3u8')) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        buf: Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'),
      };
    }
    return {
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg' },
      buf: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    };
  };

  const r = await inspectUrlTarget('https://cdn2.qceimg.cc/ya2rghpbtx4.mp4', {
    dnsLookup: publicDns,
    fetchHop,
    fetchRange,
  });

  const hls = r.resources.filter((x) => x.assetKind === 'hls');
  assert.equal(hls.length, 1);
  assert.match(hls[0].url, /master\.m3u8\?token=abc123&sess=xyz999/);
  assert.ok(!hls[0].url.includes('\\u0026'));
  assert.ok(hls[0].hlsUrl?.startsWith('/api/hls/'));
});

test('slicedrivi pattern: HTML with <video> and deceptive JS window.location.href does NOT follow trap redirect', async () => {
  const fetchHop: FetchHopFn = async (target) => {
    assert.ok(!target.normalizedUrl.includes('shopee'));
    return {
      kind: 'document',
      statusCode: 200,
      contentType: 'text/html',
      isWrapper: true,
      bodyText: `<!DOCTYPE html><html><body>
        <video controls><source src="https://cdn2.slicedrivi.com/videos/bm6hd65y7nhx.mp4" type="video/mp4"></video>
        <script>document.addEventListener('click', function(){ window.location.href = 'https://shopee.co.id/promo-jebakan'; });</script>
      </body></html>`,
      headers: { 'content-type': 'text/html' },
    };
  };

  const fetchRange: ProbeFetchFn = async () => ({
    statusCode: 206,
    headers: {
      'content-type': 'video/mp4',
      'content-range': 'bytes 0-2047/21976699',
      'accept-ranges': 'bytes',
    },
    buf: FAKE_MP4_FTYP,
  });

  const r = await inspectUrlTarget('https://cdn2.slicedrivi.com/bm6hd65y7nhx.mp4', {
    dnsLookup: publicDns,
    fetchHop,
    fetchRange,
  });

  assert.ok(!r.finalUrl.includes('shopee'));
  const media = r.resources.filter((x) => x.assetKind === 'video');
  assert.equal(media.length, 1);
  assert.equal(media[0].url, 'https://cdn2.slicedrivi.com/videos/bm6hd65y7nhx.mp4');
  assert.equal(media[0].declaredBytes, 21976699);
});
