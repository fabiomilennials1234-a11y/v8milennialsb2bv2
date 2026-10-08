import { afterEach, expect, it, vi } from 'vitest';
import { appServerAvailable, browserEnv, recoverFromStaleBuild } from '@/core/stale-build-recovery';

afterEach(() => vi.unstubAllGlobals());

it('keeps the working cached app when the origin serves an outage page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service is not reachable', { status: 503 })));
  const unregister = vi.fn().mockResolvedValue(true);
  const removeCache = vi.fn().mockResolvedValue(true);
  const reload = vi.fn();
  const env = {
    ...browserEnv(),
    now: () => 1_000_000,
    storage: null,
    serviceWorker: { getRegistrations: async () => [{ unregister }] },
    caches: { keys: async () => ['workbox-precache-v2'], delete: removeCache },
    reload,
  };
  await recoverFromStaleBuild(env);
  expect(unregister).not.toHaveBeenCalled();
  expect(removeCache).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('rejects a proxy outage page even when it returns HTTP 200', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<html>Service is not reachable</html>')));
  expect(await appServerAvailable()).toBe(false);
});

it('allows recovery once the origin serves the application again', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response('Service is not reachable', { status: 503 }))
    .mockResolvedValueOnce(new Response('<div id="root"></div><script type="module" src="/assets/index-current.js"></script>'));
  vi.stubGlobal('fetch', request);
  expect(await appServerAvailable()).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
});
