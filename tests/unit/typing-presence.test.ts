import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypingPresence } from '../../src/modules/communication/lib/typing-presence';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('chat typing lifecycle', () => {
  it('coalesces keystrokes, renews long typing and stops after idle', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const presence = createTypingPresence(send);
    for (let i = 0; i < 12; i++) { presence.typing(); await vi.advanceTimersByTimeAsync(1000); }
    expect(send.mock.calls.map(c => c[0])).toEqual(['composing', 'composing']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send.mock.calls.map(c => c[0])).toEqual(['composing', 'composing', 'available']);
  });
  it('stops old conversation and starts new without retaining composing state', async () => {
    const old = vi.fn().mockResolvedValue(undefined), next = vi.fn().mockResolvedValue(undefined);
    const a = createTypingPresence(old); a.typing(); await vi.advanceTimersByTimeAsync(0); a.dispose(); a.typing();
    const b = createTypingPresence(next); b.typing(); await vi.advanceTimersByTimeAsync(0);
    expect(old.mock.calls.map(c => c[0])).toEqual(['composing', 'available']);
    expect(next).toHaveBeenCalledWith('composing'); b.dispose();
  });
  it('serializes network requests and drops queued stale typing on stop', async () => {
    let resolve!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(undefined);
    const presence = createTypingPresence(send);
    for (let i = 0; i < 10; i++) { presence.typing(); await vi.advanceTimersByTimeAsync(1000); }
    presence.stop(); expect(send).toHaveBeenCalledTimes(1);
    resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.map(c => c[0])).toEqual(['composing', 'available']);
  });
  it('does not leak rejected transport promises or send repeated stop calls', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network'));
    const presence = createTypingPresence(send); presence.typing(); await vi.advanceTimersByTimeAsync(0);
    presence.stop(); presence.stop(); presence.dispose(); await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
