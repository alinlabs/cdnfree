export const VIDEO_SEEK_STEP_SECONDS = 10;
export const VIDEO_VOLUME_STEP = 0.1;

export type VideoShortcutScope = 'full-view' | 'mini-card';

export type VideoShortcutAction =
  | { type: 'download' }
  | { type: 'seek'; deltaSeconds: number }
  | { type: 'volume'; delta: number }
  | { type: 'prev-video' }
  | { type: 'next-video' }
  | { type: 'toggle-play' }
  | { type: 'toggle-mute' }
  | { type: 'zoom'; delta: number }
  | { type: 'reset-transform' }
  | { type: 'rotate-90' }
  | { type: 'toggle-flip-x' }
  | { type: 'toggle-flip-y' };

export interface ShortcutKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}

export interface ShortcutTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

export function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as ShortcutTargetLike;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (el.getAttribute?.('role') === 'slider') {
    return true;
  }
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) {
    return true;
  }
  return false;
}

export function hasOpenModalDialog(doc: Pick<Document, 'querySelector'> | null | undefined): boolean {
  if (!doc || typeof doc.querySelector !== 'function') return false;
  return Boolean(doc.querySelector('[role="dialog"]'));
}

export function computeSeekTarget(
  currentTime: number,
  duration: number,
  deltaSeconds: number,
): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const base = Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  return Math.min(Math.max(0, base + deltaSeconds), duration);
}

export function computeSteppedVolume(
  currentVolume: number,
  isMuted: boolean,
  delta: number,
): { volume: number; isMuted: boolean } {
  const safeVolume = Number.isFinite(currentVolume)
    ? Math.min(1, Math.max(0, currentVolume))
    : 1;
  const effective = isMuted ? 0 : safeVolume;
  const nextVolume = Math.min(1, Math.max(0, Number((effective + delta).toFixed(2))));
  return {
    volume: nextVolume,
    isMuted: nextVolume === 0,
  };
}

export function resolveVideoShortcutAction(
  event: ShortcutKeyEventLike,
  scope: VideoShortcutScope,
  zoomStep = 0.25,
): VideoShortcutAction | null {
  if (event.defaultPrevented || event.altKey) {
    return null;
  }

  const key = event.key;
  const lower = key.toLowerCase();
  const hasModifier = Boolean(event.ctrlKey || event.metaKey);

  if (hasModifier) {
    if (event.shiftKey) return null;
    if (lower === 'd') {
      return { type: 'download' };
    }
    if (scope === 'full-view') {
      if (key === 'ArrowLeft') {
        return { type: 'prev-video' };
      }
      if (key === 'ArrowRight') {
        return { type: 'next-video' };
      }
    }
    return null;
  }

  if (key === 'ArrowLeft') {
    return { type: 'seek', deltaSeconds: -VIDEO_SEEK_STEP_SECONDS };
  }
  if (key === 'ArrowRight') {
    return { type: 'seek', deltaSeconds: VIDEO_SEEK_STEP_SECONDS };
  }
  if (key === 'ArrowUp') {
    return { type: 'volume', delta: VIDEO_VOLUME_STEP };
  }
  if (key === 'ArrowDown') {
    return { type: 'volume', delta: -VIDEO_VOLUME_STEP };
  }

  if (scope === 'mini-card') {
    return null;
  }

  if (key === ' ' || lower === 'k') {
    return { type: 'toggle-play' };
  }
  if (lower === 'm') {
    return { type: 'toggle-mute' };
  }
  if (lower === 'j') {
    return { type: 'seek', deltaSeconds: -VIDEO_SEEK_STEP_SECONDS };
  }
  if (lower === 'l') {
    return { type: 'seek', deltaSeconds: VIDEO_SEEK_STEP_SECONDS };
  }
  if (key === '+' || key === '=') {
    return { type: 'zoom', delta: zoomStep };
  }
  if (key === '-' || key === '_') {
    return { type: 'zoom', delta: -zoomStep };
  }
  if (key === '0') {
    return { type: 'reset-transform' };
  }
  if (lower === 'r') {
    return { type: 'rotate-90' };
  }
  if (lower === 'h') {
    return { type: 'toggle-flip-x' };
  }
  if (lower === 'v') {
    return { type: 'toggle-flip-y' };
  }

  return null;
}
