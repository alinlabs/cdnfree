export function requestAppFullscreen(): void {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) return;
  const root = document.documentElement;
  if (typeof root.requestFullscreen === 'function') {
    void root.requestFullscreen().catch(() => {
      // Fall back cleanly to fixed inset-0 modal when browser blocks or lacks Fullscreen API (e.g. iOS Safari)
    });
  }
}

export function exitAppFullscreen(): void {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) return;
  if (typeof document.exitFullscreen === 'function') {
    void document.exitFullscreen().catch(() => {
      // Ignore fullscreen exit errors
    });
  }
}
