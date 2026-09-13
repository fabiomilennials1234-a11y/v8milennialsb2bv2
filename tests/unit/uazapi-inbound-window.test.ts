// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countUazapiInboundWindow } from '../../supabase/functions/_shared/uazapi-inbound-window';
const message = (id: string, timestamp: number, fromMe = false, isGroup = false) => ({ id, messageTimestamp: timestamp, fromMe, isGroup });
const response = (messages: unknown[], hasMore: boolean, nextOffset: number) => new Response(JSON.stringify({ messages, hasMore, nextOffset }));
afterEach(() => vi.unstubAllGlobals());
describe('UAZAPI inbound window coverage', () => {
  it('paginates, filters locally and stops after covering the cutoff', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([message('a', 110), message('b', 109, true)], true, 2))
      .mockResolvedValueOnce(response([message('c', 108, false, true), message('d', 99)], true, 4));
    vi.stubGlobal('fetch', fetcher);
    expect(await countUazapiInboundWindow('https://test', 'private', 100, { pageSize: 2 })).toBe(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ limit: 2, offset: 0 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ limit: 2, offset: 2 });
  });
  it('returns unknown for truncated coverage instead of reporting severe drift', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response([message('a', 110)], true, 1)));
    expect(await countUazapiInboundWindow('https://test', 'private', 100, { maxPages: 1 })).toBeNull();
  });
  it('rejects out of order responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([message('a', 99), message('b', 110)], false, 0)));
    expect(await countUazapiInboundWindow('https://test', 'private', 100)).toBeNull();
  });
  it('rejects missing direction metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ id: 'a', messageTimestamp: 110 }], false, 0)));
    expect(await countUazapiInboundWindow('https://test', 'private', 100)).toBeNull();
  });
  it('accepts an explicitly complete empty window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([], false, 0)));
    expect(await countUazapiInboundWindow('https://test', 'private', 100)).toBe(0);
  });
});
