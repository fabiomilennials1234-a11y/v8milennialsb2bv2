import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from '@/modules/platform/hooks/useGlobalShortcuts';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

it('g w opens the funnel list without loading or selecting an organization default', () => {
  const onShowHelp = vi.fn();
  const hook = renderHook(() => useGlobalShortcuts({ onShowHelp }));
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
  });
  expect(navigate).toHaveBeenCalledWith('/funis');
  expect(hook.result.current.find(s => s.key === 'g w')?.label).toBe('Funis');
  hook.unmount();
});
