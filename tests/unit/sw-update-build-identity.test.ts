import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signal: undefined as (() => void) | undefined,
  contains: vi.fn(),
}));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh: () => void }) => {
    state.signal = options.onNeedRefresh;
    return vi.fn();
  },
}));
vi.mock('@/shared/pwa/build-identity', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/pwa/build-identity')>(),
  workerContainsEntry: state.contains,
}));
import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

let registration: { waiting: object | null };
let script: HTMLScriptElement;
beforeEach(() => {
  vi.clearAllMocks();
  registration = { waiting: {} };
  state.contains.mockResolvedValue(true);
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: vi.fn(async () => registration) },
  });
  script = document.createElement('script');
  script.type = 'module';
  script.src = '/assets/index-current.js';
  document.head.append(script);
});
afterEach(() => {
  cleanup();
  script.remove();
  vi.unstubAllGlobals();
});

it('does not prompt a freshly loaded page already included in the pending build', async () => {
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => state.signal?.());
  expect(state.contains).toHaveBeenCalledWith(registration.waiting, script.src);
  expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledWith('/sw.js');
  expect(result.current.needRefresh).toBe(false);
});

it('still prompts for a later build after suppressing the already-current one', async () => {
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => state.signal?.());
  registration.waiting = {};
  state.contains.mockResolvedValue(false);
  await act(async () => state.signal?.());
  expect(result.current.needRefresh).toBe(true);
});

it('keeps the update action for older workers or an unknown build', async () => {
  state.contains.mockResolvedValue(false);
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => state.signal?.());
  expect(result.current.needRefresh).toBe(true);
});

it('does not trust a matching response from a worker that was replaced meanwhile', async () => {
  let answer: (matches: boolean) => void = () => undefined;
  state.contains.mockImplementation(() => new Promise<boolean>(resolve => { answer = resolve; }));
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => state.signal?.());
  registration.waiting = {};
  await act(async () => answer(true));
  expect(result.current.needRefresh).toBe(true);
});

it('keeps the prompt when inspecting the registration fails', async () => {
  vi.mocked(navigator.serviceWorker.getRegistration).mockRejectedValue(new Error('unavailable'));
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => state.signal?.());
  expect(result.current.needRefresh).toBe(true);
});
