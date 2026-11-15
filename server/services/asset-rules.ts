export type AssetKind =
  | 'image'
  | 'vector'
  | 'video'
  | 'audio'
  | 'font'
  | 'stylesheet'
  | 'pdf'
  | 'json'
  | 'hls'
  | 'dash'
  | 'wrapper'
  | 'embed'
  | 'other';

export interface ExtractRule {
  sel: string;
  attr: string;
  hint: AssetKind;
  srcset?: boolean;
  css?: boolean;
}

export const EXTRACT_RULES: ExtractRule[] = [
  // --- Gambar ---
  { sel: 'img[src]', attr: 'src', hint: 'image' },
  { sel: 'img[srcset]', attr: 'srcset', hint: 'image', srcset: true },
  { sel: 'img[data-src]', attr: 'data-src', hint: 'image' },
  { sel: 'img[data-srcset]', attr: 'data-srcset', hint: 'image', srcset: true },
  { sel: 'img[data-lazy-srcset]', attr: 'data-lazy-srcset', hint: 'image', srcset: true },
  { sel: 'img[imagesrcset]', attr: 'imagesrcset', hint: 'image', srcset: true },
  { sel: 'img[data-original]', attr: 'data-original', hint: 'image' },
  { sel: 'img[data-lazy-src]', attr: 'data-lazy-src', hint: 'image' },
  { sel: 'img[data-lazy]', attr: 'data-lazy', hint: 'image' },
  { sel: 'img[data-src-retina]', attr: 'data-src-retina', hint: 'image' },
  { sel: 'img[data-full-src]', attr: 'data-full-src', hint: 'image' },
  { sel: 'img[data-hi-res-src]', attr: 'data-hi-res-src', hint: 'image' },
  { sel: 'img[data-zoom-image]', attr: 'data-zoom-image', hint: 'image' },
  { sel: 'img[data-url]', attr: 'data-url', hint: 'image' },
  { sel: 'img[data-image]', attr: 'data-image', hint: 'image' },
  { sel: 'img[data-fallback-src]', attr: 'data-fallback-src', hint: 'image' },
  { sel: 'picture source[srcset]', attr: 'srcset', hint: 'image', srcset: true },
  { sel: 'picture source[data-srcset]', attr: 'data-srcset', hint: 'image', srcset: true },
  { sel: 'picture source[src]', attr: 'src', hint: 'image' },
  { sel: 'picture source[data-src]', attr: 'data-src', hint: 'image' },
  { sel: 'input[type="image"][src]', attr: 'src', hint: 'image' },
  { sel: '[style*="url("]', attr: 'style', hint: 'image', css: true },
  { sel: '[background]', attr: 'background', hint: 'image' },
  { sel: '[data-bg]', attr: 'data-bg', hint: 'image' },
  { sel: '[data-bg-src]', attr: 'data-bg-src', hint: 'image' },
  { sel: '[data-background]', attr: 'data-background', hint: 'image' },
  { sel: '[data-background-image]', attr: 'data-background-image', hint: 'image' },
  { sel: '[data-thumb]', attr: 'data-thumb', hint: 'image' },
  { sel: '[data-thumbnail]', attr: 'data-thumbnail', hint: 'image' },
  { sel: '[data-cover]', attr: 'data-cover', hint: 'image' },

  // --- Vektor ---
  { sel: 'object[type="image/svg+xml"][data]', attr: 'data', hint: 'vector' },
  { sel: 'embed[type="image/svg+xml"][src]', attr: 'src', hint: 'vector' },
  { sel: 'svg image[href]', attr: 'href', hint: 'vector' },
  { sel: 'svg image[xlink\\:href]', attr: 'xlink:href', hint: 'vector' },
  { sel: 'svg use[href]', attr: 'href', hint: 'vector' },
  { sel: 'svg use[xlink\\:href]', attr: 'xlink:href', hint: 'vector' },
  { sel: 'svg feImage[href]', attr: 'href', hint: 'vector' },
  { sel: 'link[rel~="icon"]', attr: 'href', hint: 'vector' },
  { sel: 'link[rel="apple-touch-icon"]', attr: 'href', hint: 'vector' },
  { sel: 'link[rel="apple-touch-icon-precomposed"]', attr: 'href', hint: 'vector' },
  { sel: 'link[rel="mask-icon"]', attr: 'href', hint: 'vector' },

  // --- Video ---
  { sel: 'video[src]', attr: 'src', hint: 'video' },
  { sel: 'video[data-src]', attr: 'data-src', hint: 'video' },
  { sel: 'video[poster]', attr: 'poster', hint: 'image' },
  { sel: 'video[data-poster]', attr: 'data-poster', hint: 'image' },
  { sel: 'video source[src]', attr: 'src', hint: 'video' },
  { sel: 'video source[data-src]', attr: 'data-src', hint: 'video' },
  { sel: 'video source[srcset]', attr: 'srcset', hint: 'video', srcset: true },
  { sel: '[data-video]', attr: 'data-video', hint: 'video' },
  { sel: '[data-video-src]', attr: 'data-video-src', hint: 'video' },
  { sel: '[data-video-url]', attr: 'data-video-url', hint: 'video' },
  { sel: '[data-mp4]', attr: 'data-mp4', hint: 'video' },
  { sel: '[data-webm]', attr: 'data-webm', hint: 'video' },
  { sel: '[data-hls]', attr: 'data-hls', hint: 'video' },
  { sel: '[data-stream-url]', attr: 'data-stream-url', hint: 'video' },
  { sel: 'video track[src]', attr: 'src', hint: 'other' },
  { sel: 'meta[property="og:video"]', attr: 'content', hint: 'video' },
  { sel: 'meta[property="og:video:url"]', attr: 'content', hint: 'video' },
  { sel: 'meta[property="og:video:secure_url"]', attr: 'content', hint: 'video' },
  { sel: 'meta[name="twitter:player:stream"]', attr: 'content', hint: 'video' },
  { sel: 'iframe[src]', attr: 'src', hint: 'other' },
  { sel: '[data-embed]', attr: 'data-embed', hint: 'embed' },
  { sel: '[data-iframe]', attr: 'data-iframe', hint: 'embed' },
  { sel: '[data-player]', attr: 'data-player', hint: 'embed' },
  { sel: '[itemprop="embedUrl"]', attr: 'content', hint: 'embed' },
  {
    sel: '[src]:not(img):not(video):not(audio):not(script):not(iframe):not(source):not(input):not(embed):not(track):not(link):not(object)',
    attr: 'src',
    hint: 'embed',
  },

  // --- Audio ---
  { sel: 'audio[src]', attr: 'src', hint: 'audio' },
  { sel: 'audio[data-src]', attr: 'data-src', hint: 'audio' },
  { sel: 'audio source[src]', attr: 'src', hint: 'audio' },
  { sel: 'audio source[data-src]', attr: 'data-src', hint: 'audio' },
  { sel: 'meta[property="og:audio"]', attr: 'content', hint: 'audio' },
  { sel: 'meta[property="og:audio:url"]', attr: 'content', hint: 'audio' },
  { sel: 'meta[property="og:audio:secure_url"]', attr: 'content', hint: 'audio' },

  // --- Generic <source> fallback for custom media elements ---
  { sel: 'source[src]', attr: 'src', hint: 'other' },
  { sel: 'source[data-src]', attr: 'data-src', hint: 'other' },
  { sel: 'source[srcset]', attr: 'srcset', hint: 'image', srcset: true },
  { sel: 'source[data-srcset]', attr: 'data-srcset', hint: 'image', srcset: true },

  // --- Stylesheet / Font / PDF / JSON / Microdata / Link Media ---
  { sel: 'link[rel="stylesheet"]', attr: 'href', hint: 'stylesheet' },
  { sel: 'link[rel="preload"][href]', attr: 'href', hint: 'other' },
  { sel: 'link[rel="prefetch"][href]', attr: 'href', hint: 'other' },
  { sel: 'link[rel="modulepreload"][href]', attr: 'href', hint: 'other' },
  { sel: 'link[rel="manifest"]', attr: 'href', hint: 'json' },
  { sel: 'link[imagesrcset]', attr: 'imagesrcset', hint: 'image', srcset: true },
  { sel: 'meta[property="og:image"]', attr: 'content', hint: 'image' },
  { sel: 'meta[property="og:image:url"]', attr: 'content', hint: 'image' },
  { sel: 'meta[property="og:image:secure_url"]', attr: 'content', hint: 'image' },
  { sel: 'meta[name="twitter:image"]', attr: 'content', hint: 'image' },
  { sel: 'meta[name="twitter:image:src"]', attr: 'content', hint: 'image' },
  { sel: 'meta[property="twitter:image"]', attr: 'content', hint: 'image' },
  { sel: 'meta[name="msapplication-TileImage"]', attr: 'content', hint: 'image' },
  { sel: 'meta[name="thumbnail"]', attr: 'content', hint: 'image' },
  { sel: 'meta[itemprop="image"]', attr: 'content', hint: 'image' },
  { sel: 'meta[itemprop="thumbnailUrl"]', attr: 'content', hint: 'image' },
  { sel: 'meta[itemprop="contentUrl"]', attr: 'content', hint: 'video' },
  { sel: 'link[itemprop="image"]', attr: 'href', hint: 'image' },
  { sel: 'link[itemprop="thumbnailUrl"]', attr: 'href', hint: 'image' },
  { sel: 'link[itemprop="contentUrl"]', attr: 'href', hint: 'video' },
  { sel: 'a[href][download]', attr: 'href', hint: 'other' },
  { sel: 'a[href$=".pdf"]', attr: 'href', hint: 'pdf' },
  { sel: 'a[href$=".svg"]', attr: 'href', hint: 'vector' },
  { sel: 'a[href$=".mp4"]', attr: 'href', hint: 'video' },
  { sel: 'a[href$=".webm"]', attr: 'href', hint: 'video' },
  { sel: 'a[href$=".mp3"]', attr: 'href', hint: 'audio' },
  { sel: 'a[href$=".m3u8"]', attr: 'href', hint: 'video' },
  { sel: 'object[data]', attr: 'data', hint: 'other' },
  { sel: 'embed[src]', attr: 'src', hint: 'other' },
];
