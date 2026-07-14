import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted so the mock factory can reference mockRegisterSW
// ---------------------------------------------------------------------------
const { mockRegisterSW, mockUpdateSW } = vi.hoisted(() => {
  const mockUpdateSW = vi.fn();
  const mockRegisterSW = vi.fn(() => mockUpdateSW);
  return { mockRegisterSW, mockUpdateSW };
});

vi.mock('virtual:pwa-register', () => ({
  registerSW: mockRegisterSW,
}));

import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

describe('useServiceWorkerUpdate — registration + update signal', () => {
  let capturedOnNeedRefresh: (() => void) | undefined;
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnNeedRefresh = undefined;
    setVisibility('visible');

    // updateSW arms a fallback setTimeout(reload) — stub reload so orphaned
    // timers can't trigger jsdom navigation between tests.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: vi.fn() },
      configurable: true,
    });

    mockRegisterSW.mockImplementation((opts?: Record<string, unknown>) => {
      if (opts && typeof opts.onNeedRefresh === 'function') {
        capturedOnNeedRefresh = opts.onNeedRefresh as () => void;
      }
      return mockUpdateSW;
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    });
  });

  it('registers SW on mount with immediate:true', () => {
    renderHook(() => useServiceWorkerUpdate());
    expect(mockRegisterSW).toHaveBeenCalledOnce();
    const callArgs = mockRegisterSW.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.immediate).toBe(true);
  });

  it('exposes needRefresh=false initially', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current.needRefresh).toBe(false);
  });

  it('sets needRefresh=true when SW signals update', () => {
    setVisibility('visible'); // avoid immediate apply
    const { result } = renderHook(() => useServiceWorkerUpdate());

    act(() => {
      capturedOnNeedRefresh?.();
    });

    expect(result.current.needRefresh).toBe(true);
  });

  it('flags needRefresh only once even if registerSW signals twice', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());

    act(() => {
      capturedOnNeedRefresh?.();
      capturedOnNeedRefresh?.();
    });

    expect(result.current.needRefresh).toBe(true);
  });

  it('updateSW() delegates to registerSW return value', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());

    act(() => {
      result.current.updateSW();
    });

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  // O reload do build prompt depende de event.isUpdate no 'controlling',
  // congelado como false em páginas que começaram sem controller. O hook
  // precisa garantir o reload por conta própria.
  it('updateSW() arms a once controllerchange listener before skipping waiting', () => {
    const addEventListener = vi.fn();
    const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { addEventListener },
      configurable: true,
    });

    try {
      const { result } = renderHook(() => useServiceWorkerUpdate());
      act(() => {
        result.current.updateSW();
      });

      expect(addEventListener).toHaveBeenCalledWith(
        'controllerchange',
        expect.any(Function),
        { once: true },
      );
      expect(mockUpdateSW).toHaveBeenCalledWith(true);
    } finally {
      if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
      else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  it('updateSW() force-reloads via fallback when controllerchange never fires', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload },
      configurable: true,
    });
    const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;

    try {
      const { result } = renderHook(() => useServiceWorkerUpdate());
      act(() => {
        result.current.updateSW();
      });

      expect(reload).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
      vi.useRealTimers();
    }
  });
});

describe('useServiceWorkerUpdate — silent auto-apply', () => {
  let capturedOnNeedRefresh: (() => void) | undefined;
  let originalLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedOnNeedRefresh = undefined;
    setVisibility('visible');

    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: vi.fn() },
      configurable: true,
    });

    mockRegisterSW.mockImplementation((opts?: Record<string, unknown>) => {
      if (opts && typeof opts.onNeedRefresh === 'function') {
        capturedOnNeedRefresh = opts.onNeedRefresh as () => void;
      }
      return mockUpdateSW;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    });
  });

  it('does not apply while visible and active (before idle window)', () => {
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });

    act(() => {
      vi.advanceTimersByTime(60_000); // < 2min idle window
    });
    expect(mockUpdateSW).not.toHaveBeenCalled();
  });

  it('applies once the visible tab has been idle for the idle window', () => {
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it('user interaction resets the idle timer so a typing user is never reloaded', () => {
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });

    act(() => {
      vi.advanceTimersByTime(90_000); // almost there
      document.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(90_000); // reset → still under window
    });
    expect(mockUpdateSW).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000); // now crosses the reset window
    });
    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it('applies immediately when the tab is hidden at signal time', () => {
    setVisibility('hidden');
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it('applies as soon as the tab becomes hidden', () => {
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });
    expect(mockUpdateSW).not.toHaveBeenCalled();

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it('applies the update at most once', () => {
    setVisibility('hidden');
    renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnNeedRefresh?.();
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(mockUpdateSW).toHaveBeenCalledTimes(1);
  });
});

describe('useServiceWorkerUpdate — periodic update check', () => {
  const HOUR_MS = 60 * 60 * 1000;

  let capturedOnRegisteredSW:
    | ((swUrl: string, r?: Partial<ServiceWorkerRegistration>) => void)
    | undefined;
  let mockRegistration: { installing: null | object; update: ReturnType<typeof vi.fn> };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedOnRegisteredSW = undefined;
    mockRegistration = { installing: null, update: vi.fn().mockResolvedValue(undefined) };
    fetchSpy = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    mockRegisterSW.mockImplementation((opts?: Record<string, unknown>) => {
      if (opts && typeof opts.onRegisteredSW === 'function') {
        capturedOnRegisteredSW = opts.onRegisteredSW as typeof capturedOnRegisteredSW;
      }
      return mockUpdateSW;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mountAndRegister() {
    const rendered = renderHook(() => useServiceWorkerUpdate());
    act(() => {
      capturedOnRegisteredSW?.('/sw.js', mockRegistration as ServiceWorkerRegistration);
    });
    return rendered;
  }

  it('polls sw.js and calls registration.update() every hour', async () => {
    mountAndRegister();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });

    expect(fetchSpy).toHaveBeenCalledWith('/sw.js', expect.objectContaining({ cache: 'no-store' }));
    expect(mockRegistration.update).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);
  });

  it('does not call update() when sw.js fetch is not 200', async () => {
    fetchSpy.mockResolvedValue({ status: 404 });
    mountAndRegister();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });

    expect(mockRegistration.update).not.toHaveBeenCalled();
  });

  it('skips the tick while another SW is installing', async () => {
    mockRegistration.installing = {};
    mountAndRegister();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockRegistration.update).not.toHaveBeenCalled();
  });

  it('survives a network error and retries on the next tick', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));
    mountAndRegister();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });
    expect(mockRegistration.update).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOUR_MS);
    });
    expect(mockRegistration.update).toHaveBeenCalledOnce();
  });

  it('stops polling on unmount', async () => {
    const { unmount } = mountAndRegister();
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockRegistration.update).not.toHaveBeenCalled();
  });
});
