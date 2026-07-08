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

describe('useServiceWorkerUpdate', () => {
  let capturedOnNeedRefresh: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnNeedRefresh = undefined;

    mockRegisterSW.mockImplementation((opts?: Record<string, unknown>) => {
      if (opts && typeof opts.onNeedRefresh === 'function') {
        capturedOnNeedRefresh = opts.onNeedRefresh as () => void;
      }
      return mockUpdateSW;
    });
  });

  it('registers SW on mount', () => {
    renderHook(() => useServiceWorkerUpdate());
    expect(mockRegisterSW).toHaveBeenCalledOnce();
  });

  it('exposes needRefresh=false initially', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current.needRefresh).toBe(false);
  });

  it('sets needRefresh=true when SW signals update', () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());

    act(() => {
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

  it('calls onNeedRefresh callback when provided', () => {
    const onNeedRefresh = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onNeedRefresh }));

    act(() => {
      capturedOnNeedRefresh?.();
    });

    expect(onNeedRefresh).toHaveBeenCalledOnce();
  });

  // workbox-window classifica update achado >60s após o register como
  // "externo" e dispara installed+waiting para o mesmo SW → o build prompt
  // chama onNeedRefresh duas vezes. Sem guard = 2 toasts Infinity empilhados.
  it('invokes onNeedRefresh callback only once even if registerSW signals twice', () => {
    const onNeedRefresh = vi.fn();
    const { result } = renderHook(() => useServiceWorkerUpdate({ onNeedRefresh }));

    act(() => {
      capturedOnNeedRefresh?.();
      capturedOnNeedRefresh?.();
    });

    expect(onNeedRefresh).toHaveBeenCalledOnce();
    expect(result.current.needRefresh).toBe(true);
  });

  // O reload do build prompt depende de event.isUpdate no 'controlling',
  // congelado como false em páginas que começaram sem controller (primeira
  // visita, shift-reload). O hook precisa garantir o reload por conta própria.
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

  it('registers with immediate:true for auto-check', () => {
    renderHook(() => useServiceWorkerUpdate());

    const callArgs = mockRegisterSW.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.immediate).toBe(true);
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
