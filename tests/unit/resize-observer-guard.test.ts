import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installResizeObserverGuard,
  isResizeObserverLoopErrorMessage,
} from '../../src/utils/suppress-resize-observer-error';

test('isResizeObserverLoopErrorMessage identifies Chromium ResizeObserver loop notifications only', () => {
  assert.equal(
    isResizeObserverLoopErrorMessage(
      'ResizeObserver loop completed with undelivered notifications.',
    ),
    true,
  );
  assert.equal(
    isResizeObserverLoopErrorMessage('ResizeObserver loop limit exceeded'),
    true,
  );
  assert.equal(
    isResizeObserverLoopErrorMessage('TypeError: Cannot read properties of null'),
    false,
  );
  assert.equal(isResizeObserverLoopErrorMessage(null), false);
});

test('installResizeObserverGuard suppresses ResizeObserver loop ErrorEvents and preserves real errors', () => {
  type Listener = (event: Event) => void;
  const captureListeners: Listener[] = [];

  const mockWindow = {
    addEventListener(type: string, cb: Listener, capture?: boolean) {
      if (type === 'error' && capture) {
        captureListeners.push(cb);
      }
    },
    removeEventListener(type: string, cb: Listener, capture?: boolean) {
      if (type === 'error' && capture) {
        const idx = captureListeners.indexOf(cb);
        if (idx >= 0) captureListeners.splice(idx, 1);
      }
    },
  } as unknown as Window;

  const cleanup = installResizeObserverGuard(mockWindow);
  assert.equal(captureListeners.length, 1);

  let prevented = false;
  let stoppedImmediate = false;
  let stopped = false;
  captureListeners[0]({
    message: 'ResizeObserver loop completed with undelivered notifications.',
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {
      stoppedImmediate = true;
    },
    stopPropagation() {
      stopped = true;
    },
  } as unknown as Event);

  assert.equal(prevented, true);
  assert.equal(stoppedImmediate, true);
  assert.equal(stopped, true);

  let realPrevented = false;
  captureListeners[0]({
    message: 'Uncaught ReferenceError: foo is not defined',
    preventDefault() {
      realPrevented = true;
    },
    stopImmediatePropagation() {},
    stopPropagation() {},
  } as unknown as Event);

  assert.equal(realPrevented, false);

  cleanup();
  assert.equal(captureListeners.length, 0);
});
