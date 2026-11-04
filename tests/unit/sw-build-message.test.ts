import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentAppEntry, MATCH_APP_ENTRY, workerContainsEntry } from '@/shared/pwa/build-identity';

let port: { onmessage: ((event: { data: unknown }) => void) | null; close: ReturnType<typeof vi.fn> };
let peer: { close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  port = { onmessage: null, close: vi.fn() };
  peer = { close: vi.fn() };
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = peer; });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('accepts only a positive answer from the queried worker and closes its ports', async () => {
  const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const result = workerContainsEntry(worker, 'https://app.test/assets/current.js');
  expect(worker.postMessage).toHaveBeenCalledWith({ type: MATCH_APP_ENTRY, entry: 'https://app.test/assets/current.js' }, [peer]);
  port.onmessage?.({ data: { type: MATCH_APP_ENTRY, matches: true } });
  expect(await result).toBe(true);
  expect(port.close).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the prompt when an older worker never answers', async () => {
  const result = workerContainsEntry({ postMessage: vi.fn() } as unknown as ServiceWorker, '/assets/current.js');
  await vi.advanceTimersByTimeAsync(1500);
  expect(await result).toBe(false);
  expect(port.close).toHaveBeenCalledOnce();
  expect(peer.close).toHaveBeenCalledOnce();
});

it('keeps the prompt when sending fails or the reply is not the expected protocol', async () => {
  const failedWorker = { postMessage: () => { throw new Error('redundant'); } } as unknown as ServiceWorker;
  expect(await workerContainsEntry(failedWorker, '/assets/current.js')).toBe(false);
  const result = workerContainsEntry({ postMessage: vi.fn() } as unknown as ServiceWorker, '/assets/current.js');
  port.onmessage?.({ data: { type: 'UNKNOWN', matches: true } });
  expect(await result).toBe(false);
});

it('uses only a module entry from this application origin', () => {
  const external = document.createElement('script');
  external.type = 'module';
  external.src = 'https://external.test/assets/index.js';
  const own = document.createElement('script');
  own.type = 'module';
  own.src = '/assets/index-current.js';
  document.head.append(external, own);
  try {
    expect(currentAppEntry()).toBe(own.src);
  } finally {
    external.remove();
    own.remove();
  }
});
