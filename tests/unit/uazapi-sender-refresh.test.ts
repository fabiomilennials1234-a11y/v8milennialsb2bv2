// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { refreshSenderSnapshot } from '../../supabase/functions/_shared/uazapi-sender-refresh';
it('preserves the last state when provider polling fails', async () => {
  const save = vi.fn();
  await expect(refreshSenderSnapshot(async () => { throw new Error('timeout'); }, save)).rejects.toThrow('timeout');
  expect(save).not.toHaveBeenCalled();
});
it.each([{ status: 'future', sent: 0, failed: 0, total: 1 }, { status: 'running', sent: 2, failed: 0, total: 1 }])('rejects an invalid snapshot', async snapshot => {
  const save = vi.fn(); await expect(refreshSenderSnapshot(async () => snapshot, save)).rejects.toThrow(); expect(save).not.toHaveBeenCalled();
});
it('saves authoritative state and propagates database failure', async () => {
  const snapshot = { status: 'running', sent: 1, failed: 0, total: 2 };
  const save = vi.fn().mockResolvedValue(undefined);
  expect(await refreshSenderSnapshot(async () => snapshot, save)).toEqual(snapshot);
  expect(save).toHaveBeenCalledWith(snapshot);
  await expect(refreshSenderSnapshot(async () => snapshot, async () => { throw new Error('db unavailable'); })).rejects.toThrow('db unavailable');
});
