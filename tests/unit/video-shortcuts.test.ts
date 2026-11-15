import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSeekTarget,
  computeSteppedVolume,
  isEditableKeyboardTarget,
  resolveVideoShortcutAction,
} from '../../src/pages/hasil-pencarian/media-player/video-shortcuts.ts';

test('resolveVideoShortcutAction maps full-view shortcuts accurately', () => {
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowLeft' }, 'full-view'),
    { type: 'seek', deltaSeconds: -10 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowRight' }, 'full-view'),
    { type: 'seek', deltaSeconds: 10 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowUp' }, 'full-view'),
    { type: 'volume', delta: 0.1 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowDown' }, 'full-view'),
    { type: 'volume', delta: -0.1 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowLeft', ctrlKey: true }, 'full-view'),
    { type: 'prev-video' },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowRight', ctrlKey: true }, 'full-view'),
    { type: 'next-video' },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'd', ctrlKey: true }, 'full-view'),
    { type: 'download' },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'D', ctrlKey: true }, 'full-view'),
    { type: 'download' },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: ' ' }, 'full-view'),
    { type: 'toggle-play' },
  );
  // Shift+Ctrl+D or Ctrl+C should not be captured
  assert.equal(
    resolveVideoShortcutAction({ key: 'D', ctrlKey: true, shiftKey: true }, 'full-view'),
    null,
  );
  assert.equal(
    resolveVideoShortcutAction({ key: 'c', ctrlKey: true }, 'full-view'),
    null,
  );
  assert.equal(
    resolveVideoShortcutAction({ key: 'ArrowLeft', altKey: true }, 'full-view'),
    null,
  );
});

test('resolveVideoShortcutAction restricts mini-card scope to Ctrl+D, ArrowLeft/Right, and ArrowUp/Down only', () => {
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowLeft' }, 'mini-card'),
    { type: 'seek', deltaSeconds: -10 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowRight' }, 'mini-card'),
    { type: 'seek', deltaSeconds: 10 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowUp' }, 'mini-card'),
    { type: 'volume', delta: 0.1 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'ArrowDown' }, 'mini-card'),
    { type: 'volume', delta: -0.1 },
  );
  assert.deepEqual(
    resolveVideoShortcutAction({ key: 'd', ctrlKey: true }, 'mini-card'),
    { type: 'download' },
  );

  // Disallowed on mini cards: Ctrl+ArrowLeft/Right, Space, M, R, H, V, etc.
  assert.equal(
    resolveVideoShortcutAction({ key: 'ArrowLeft', ctrlKey: true }, 'mini-card'),
    null,
  );
  assert.equal(
    resolveVideoShortcutAction({ key: 'ArrowRight', ctrlKey: true }, 'mini-card'),
    null,
  );
  assert.equal(resolveVideoShortcutAction({ key: ' ' }, 'mini-card'), null);
  assert.equal(resolveVideoShortcutAction({ key: 'm' }, 'mini-card'), null);
  assert.equal(resolveVideoShortcutAction({ key: 'r' }, 'mini-card'), null);
});

test('computeSeekTarget clamps between 0 and finite duration', () => {
  assert.equal(computeSeekTarget(5, 100, -10), 0);
  assert.equal(computeSeekTarget(95, 100, 10), 100);
  assert.equal(computeSeekTarget(20, 100, 10), 30);
  assert.equal(computeSeekTarget(20, 100, -10), 10);
  assert.equal(computeSeekTarget(0, 0, 10), null);
  assert.equal(computeSeekTarget(0, Number.NaN, 10), null);
});

test('computeSteppedVolume handles unmuting from muted state and clamping [0, 1]', () => {
  // Starting muted (effective 0), ArrowUp raises to 10% and unmutes
  assert.deepEqual(computeSteppedVolume(1, true, 0.1), {
    volume: 0.1,
    isMuted: false,
  });
  // Pressing ArrowDown while muted keeps 0 and muted
  assert.deepEqual(computeSteppedVolume(1, true, -0.1), {
    volume: 0,
    isMuted: true,
  });
  // Pressing ArrowDown from 0.1 mutes at 0
  assert.deepEqual(computeSteppedVolume(0.1, false, -0.1), {
    volume: 0,
    isMuted: true,
  });
  // Clamps at 1.0
  assert.deepEqual(computeSteppedVolume(0.95, false, 0.1), {
    volume: 1,
    isMuted: false,
  });
});

test('isEditableKeyboardTarget detects inputs, sliders, and contentEditable targets', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableKeyboardTarget({
      tagName: 'DIV',
      getAttribute: (name: string) => (name === 'role' ? 'slider' : null),
    }),
    true,
  );
  assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableKeyboardTarget(null), false);
});
