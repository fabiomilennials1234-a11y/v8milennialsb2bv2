import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTypingPresence } from '../../src/modules/communication/hooks/chat/useTypingPresence';
import { setPresence } from '../../src/modules/communication/lib/whatsappApi';
vi.mock('../../src/modules/communication/lib/whatsappApi', () => ({ setPresence: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => { vi.useFakeTimers(); vi.mocked(setPresence).mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('does not emit when reply permission is absent', () => {
  const { result } = renderHook(() => useTypingPresence('instance', 'phone', false));
  act(() => result.current.typing());
  expect(setPresence).not.toHaveBeenCalled();
});
it('stops on permission loss and preserves the old destination on navigation', async () => {
  const { result, rerender } = renderHook(({ phone, enabled }) => useTypingPresence('instance', phone, enabled), { initialProps: { phone: 'a', enabled: true } });
  await act(async () => { result.current.typing(); });
  await act(async () => { rerender({ phone: 'b', enabled: true }); });
  await act(async () => { result.current.typing(); });
  await act(async () => { rerender({ phone: 'b', enabled: false }); });
  act(() => result.current.typing());
  expect(vi.mocked(setPresence).mock.calls).toEqual([
    ['instance', 'a', 'composing'], ['instance', 'a', 'available'],
    ['instance', 'b', 'composing'], ['instance', 'b', 'available'],
  ]);
});
