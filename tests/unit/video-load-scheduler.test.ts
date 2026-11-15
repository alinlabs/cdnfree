import test from 'node:test';
import assert from 'node:assert/strict';
import { VideoLoadScheduler } from '../../src/services/video-load-scheduler.ts';

test('VideoLoadScheduler enforces max concurrent cap and prioritizes newest LIFO requests', async () => {
  const scheduler = new VideoLoadScheduler(2);
  const order: string[] = [];

  const l1 = await scheduler.requestPreloadSlot('c1');
  const l2 = await scheduler.requestPreloadSlot('c2');
  assert.equal(scheduler.getActiveCount(), 2);

  const p3 = scheduler.requestPreloadSlot('c3', { priority: 1 }).then((l) => {
    order.push('c3');
    return l;
  });
  const p4 = scheduler.requestPreloadSlot('c4', { priority: 1 }).then((l) => {
    order.push('c4');
    return l;
  });
  assert.equal(scheduler.getQueueLength(), 2);

  // Releasing slot 1 grants c4 (most recent LIFO at same priority) before c3
  l1.release();
  const l4 = await p4;
  assert.deepEqual(order, ['c4']);

  l2.release();
  const l3 = await p3;
  assert.deepEqual(order, ['c4', 'c3']);

  l3.release();
  l4.release();
  assert.equal(scheduler.getActiveCount(), 0);
});

test('VideoLoadScheduler aborts background preloads during active play and Full View', async () => {
  const scheduler = new VideoLoadScheduler(2);
  const abortedIds: string[] = [];

  await scheduler.requestPreloadSlot('bg-1', {
    onAbort: () => abortedIds.push('bg-1'),
  });
  await scheduler.requestPreloadSlot('bg-1b');
  const queuedPromise = scheduler.requestPreloadSlot('bg-2', {
    onAbort: () => abortedIds.push('bg-2'),
  });
  assert.equal(scheduler.getActiveCount(), 2);
  assert.equal(scheduler.getQueueLength(), 1);

  // Entering active player aborts all non-matching active & queued preloads
  scheduler.setActivePlayer('hero-card');
  const qRes = await queuedPromise;
  assert.equal(qRes.aborted, true);
  assert.ok(abortedIds.includes('bg-1'));
  assert.ok(abortedIds.includes('bg-2'));
  assert.equal(scheduler.isBackgroundPaused(), true);

  // Entering Full View blocks any new preload slot immediately
  scheduler.setActivePlayer(null);
  scheduler.setFullViewActive(true);
  const blocked = await scheduler.requestPreloadSlot('bg-new');
  assert.equal(blocked.aborted, true);

  // Exiting Full View allows preloading again
  scheduler.setFullViewActive(false);
  const resumed = await scheduler.requestPreloadSlot('bg-after');
  assert.equal(resumed.aborted, false);
  resumed.release();
});
