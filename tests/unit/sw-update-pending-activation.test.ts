import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callbacks, updateWorker } = vi.hoisted(() => ({
  callbacks: {} as Record<string, (...args: unknown[]) => void>,
  updateWorker: vi.fn(),
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: typeof callbacks) => {
    Object.assign(callbacks, options);
    return updateWorker;
  },
}));
import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

describe('pending service worker activation', () => {
  const originalLocation = window.location;
  const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  let reload: ReturnType<typeof vi.fn>;
  let container: EventTarget;
  let registration: { waiting: object | null; installing: object | null; active: { state: string } };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updateWorker.mockResolvedValue(undefined);
    reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
    registration = { waiting: { state: 'installed' }, installing: null, active: { state: 'activated' } };
    container = Object.assign(new EventTarget(), { getRegistration: vi.fn(async () => registration) });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
    else Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('does not reload the old worker after three seconds; reloads once activation finishes', async () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    act(() => { callbacks.onNeedRefresh(); result.current.updateSW(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.isUpdating).toBe(true);
    registration.waiting = null;
    act(() => { container.dispatchEvent(new Event('controllerchange')); callbacks.onNeedReload(); });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads a stale notification only after confirming there is no pending worker', async () => {
    registration.waiting = null;
    const { result } = renderHook(() => useServiceWorkerUpdate());
    act(() => result.current.updateSW());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offers a retry instead of reloading while activation is still blocked', async () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    act(() => { callbacks.onNeedRefresh(); result.current.updateSW(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.updateFailed).toBe(true);
    act(() => result.current.updateSW());
    expect(updateWorker).toHaveBeenCalledTimes(2);
  });

  it('does not reload later after a timed-out action or an unmount', async () => {
    const { result, unmount } = renderHook(() => useServiceWorkerUpdate());
    act(() => result.current.updateSW());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    act(() => { container.dispatchEvent(new Event('controllerchange')); callbacks.onNeedReload(); });
    expect(reload).not.toHaveBeenCalled();
    act(() => result.current.updateSW());
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('allows retry when requesting activation fails', async () => {
    updateWorker.mockRejectedValueOnce(new Error('worker unavailable'));
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await act(async () => result.current.updateSW());
    expect(result.current.updateFailed).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    act(() => result.current.updateSW());
    expect(updateWorker).toHaveBeenCalledTimes(2);
  });
});
