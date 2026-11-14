import introVideoUrl from '../assets/into-landscape.mp4';
import type { MediaBookmark } from '../types/bookmark';
import { buildBookmarkId } from '../services/bookmark-service';
import { LOCAL_MEDIA_HOST_LABEL } from '../utils/local-media';

export const DEFAULT_LOGO_URL = '/logo.webp';
export const DEFAULT_INTRO_VIDEO_TITLE = 'into-landscape.mp4';

export function getDefaultMediaBookmarks(): MediaBookmark[] {
  const now = new Date().toISOString();
  return [
    {
      id: buildBookmarkId(DEFAULT_LOGO_URL),
      url: DEFAULT_LOGO_URL,
      kind: 'image',
      host: LOCAL_MEDIA_HOST_LABEL,
      title: 'logo.webp',
      mimeType: 'image/webp',
      declaredBytes: 18316,
      savedAt: now,
    },
    {
      id: buildBookmarkId(introVideoUrl),
      url: introVideoUrl,
      kind: 'video',
      host: LOCAL_MEDIA_HOST_LABEL,
      title: DEFAULT_INTRO_VIDEO_TITLE,
      mimeType: 'video/mp4',
      declaredBytes: 1289934,
      savedAt: now,
    },
  ];
}
