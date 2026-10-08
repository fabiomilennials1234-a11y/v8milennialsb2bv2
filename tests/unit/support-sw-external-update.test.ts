import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const transport = vi.hoisted(() => {
  type Event = { isUpdate?: boolean; isExternal?: boolean };
  class Workbox {
    handlers = new Map<string, Array<(event: Event) => void>>();
    messageSkipWaiting = vi.fn();
    constructor() { state.instance = this; }
    addEventListener(name: string, callback: (event: Event) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), callback]);
    }
    register() { return Promise.resolve({}); }
    emit(name: string, event: Event) {
      this.handlers.get(name)?.forEach(callback => callback(event));
    }
  }
  const state: { instance?: Workbox } = {};
  return { Workbox, state };
});

vi.mock('virtual:pwa-register', async () => {
  const { readFile } = await import('node:fs/promises');
  // Exercise the installed client's real controlling/reload decision. Only
  // replace the Workbox transport so another tab's activation is deterministic.
  const source = await readFile('node_modules/vite-plugin-pwa/dist/client/build/register.js', 'utf8');
  vi.stubGlobal('SupportTestWorkbox', transport.Workbox);
  const instrumented = source.replace('import("workbox-window")', 'Promise.resolve({ Workbox: globalThis.SupportTestWorkbox })');
  const url = `data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`;
  return import(/* @vite-ignore */ url);
});

import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

const originalLocation = window.location;
beforeEach(() => {
  transport.state.instance = undefined;
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { serviceWorker: new EventTarget() });
  Object.defineProperty(window, 'location', { value: { ...originalLocation, reload: vi.fn() }, configurable: true });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
});

it('does not reload this tab when another tab accepts the pending update', async () => {
  renderHook(() => useServiceWorkerUpdate());
  await act(async () => { await Promise.resolve(); });
  expect(transport.state.instance).toBeDefined();
  act(() => transport.state.instance?.emit('waiting', { isUpdate: true }));
  act(() => transport.state.instance?.emit('controlling', { isUpdate: true, isExternal: true }));
  expect(transport.state.instance?.messageSkipWaiting).not.toHaveBeenCalled();
  expect(window.location.reload).not.toHaveBeenCalled();
});

it('reloads once when this tab accepts, despite library, native and fallback signals', async () => {
  const { result } = renderHook(() => useServiceWorkerUpdate());
  await act(async () => { await Promise.resolve(); });
  expect(transport.state.instance).toBeDefined();
  act(() => transport.state.instance?.emit('waiting', { isUpdate: true }));
  await act(async () => result.current.updateSW());
  act(() => {
    transport.state.instance?.emit('controlling', { isUpdate: true });
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    vi.advanceTimersByTime(3_000);
  });
  expect(transport.state.instance?.messageSkipWaiting).toHaveBeenCalledOnce();
  expect(window.location.reload).toHaveBeenCalledOnce();
});
