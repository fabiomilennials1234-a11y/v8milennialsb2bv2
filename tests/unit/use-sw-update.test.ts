import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('registers with immediate:true for auto-check', () => {
    renderHook(() => useServiceWorkerUpdate());

    const callArgs = mockRegisterSW.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.immediate).toBe(true);
  });
});
