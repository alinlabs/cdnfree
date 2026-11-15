export function isOpaqueOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.origin === 'null') {
      return true;
    }
    window.localStorage.setItem('__cdnfree_probe', '1');
    window.localStorage.removeItem('__cdnfree_probe');
    return false;
  } catch {
    return true;
  }
}

export function isNestedPreviewFrame(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top || window.top !== window.parent;
  } catch {
    return true;
  }
}
