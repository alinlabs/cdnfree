const RESIZE_OBSERVER_LOOP_RE =
  /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i;

const installedWindows = new WeakSet<object>();

export function isResizeObserverLoopErrorMessage(message: unknown): boolean {
  return typeof message === 'string' && RESIZE_OBSERVER_LOOP_RE.test(message);
}

function shouldSuppressErrorEvent(event: Event): boolean {
  const errEvent = event as ErrorEvent & { reason?: unknown };
  if (isResizeObserverLoopErrorMessage(errEvent.message)) {
    return true;
  }
  const errObj = errEvent.error as { message?: unknown } | undefined;
  if (errObj && isResizeObserverLoopErrorMessage(errObj.message)) {
    return true;
  }
  return false;
}

function wrapResizeObserverConstructor(targetWindow: Window): void {
  const win = targetWindow as Window & {
    ResizeObserver?: typeof ResizeObserver;
    __cdnfreeWrappedRO?: boolean;
  };
  const NativeRO = win.ResizeObserver;
  if (typeof NativeRO !== 'function' || win.__cdnfreeWrappedRO) {
    return;
  }

  const SafeResizeObserver = class extends NativeRO {
    constructor(callback: ResizeObserverCallback) {
      let pendingFrame: number | null = null;
      let latestEntries: ResizeObserverEntry[] = [];
      let latestObserver: ResizeObserver | null = null;

      super((entries, observer) => {
        latestEntries = entries;
        latestObserver = observer;
        if (pendingFrame !== null) return;
        const schedule =
          typeof targetWindow.requestAnimationFrame === 'function'
            ? targetWindow.requestAnimationFrame.bind(targetWindow)
            : (fn: FrameRequestCallback) =>
                targetWindow.setTimeout(() => fn(Date.now()), 16);

        pendingFrame = schedule(() => {
          pendingFrame = null;
          if (!latestObserver) return;
          const batch = latestEntries;
          const activeObserver = latestObserver;
          latestEntries = [];
          callback(batch, activeObserver);
        });
      });
    }
  };

  try {
    Object.defineProperty(SafeResizeObserver, 'name', {
      value: 'ResizeObserver',
    });
    win.ResizeObserver = SafeResizeObserver as typeof ResizeObserver;
    win.__cdnfreeWrappedRO = true;
  } catch {
    // Ignore read-only ResizeObserver environments
  }
}

export function installResizeObserverGuard(
  targetWindow: Window | null | undefined =
    typeof window !== 'undefined' ? window : null,
): () => void {
  if (!targetWindow || installedWindows.has(targetWindow)) {
    return () => {};
  }
  installedWindows.add(targetWindow);

  wrapResizeObserverConstructor(targetWindow);

  const handleCaptureError = (event: Event) => {
    if (!shouldSuppressErrorEvent(event)) return;
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    event.stopPropagation();
  };

  targetWindow.addEventListener('error', handleCaptureError, true);

  return () => {
    targetWindow.removeEventListener('error', handleCaptureError, true);
  };
}
