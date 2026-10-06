import { describe, it, expect, vi } from 'vitest';
import { transcribeChatAudio, TRANSCRIPTION_BUDGET_MS, TRANSCRIPTION_LEASE_MS } from '../../supabase/functions/_shared/whatsapp-transcription';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppProvider } from '../../supabase/functions/_shared/whatsapp-client';

const id = '11111111-1111-4111-8111-111111111111';
const ORG = '4922638c-4909-494e-ba10-12282ec0b161';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const storageUrl = (org: string) => `https://example.supabase.co/storage/v1/object/public/media/whatsapp-media/${org}/instance/audio.ogg`;

type Options = {
  missing?: boolean; denied?: boolean; cached?: boolean; busy?: boolean; type?: string;
  mediaUrl?: string | null; transcript?: string | null; storageError?: boolean; blobSize?: number;
  providerDownload?: 'ok' | 'not_found' | 'error'; infoSize?: number; slowMs?: number; budgetMs?: number;
};

function fixture(options: Options = {}) {
  const message = {
    id, message_id: 'provider-id', phone_number: '5548999990000', message_type: options.type ?? 'audio',
    media_url: 'mediaUrl' in options ? options.mediaUrl : storageUrl(ORG),
    ...(options.cached ? { transcription_text: 'cached', transcription_provider: 'gemini-2.5-flash', transcription_created_at: '2026-09-11T00:00:00Z' } : {}),
  };
  const chain = (data: unknown) => { const b = { select: vi.fn(() => b), eq: vi.fn(() => b), is: vi.fn(() => b), or: vi.fn(() => b), update: vi.fn(() => b), maybeSingle: vi.fn(async () => ({ data, error: null })), then: (fn: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(fn) }; return b; };
  const read = chain(options.missing ? null : message), claim = chain(options.busy ? null : { id }), saved = chain({ id }), release = chain(null);
  const user = { from: vi.fn(() => read), rpc: vi.fn(async () => ({ data: !options.denied, error: null })) };
  const blob = { size: options.blobSize ?? 4, type: 'audio/ogg', arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
  const download = vi.fn(async () => options.storageError ? { data: null, error: new Error('Object not found') } : { data: blob, error: null });
  const info = vi.fn(async () => options.storageError ? { data: null, error: new Error('Object not found') } : { data: { size: options.infoSize ?? 4, contentType: 'audio/ogg' }, error: null });
  const storageFrom = vi.fn(() => ({ download, info }));
  const admin = { from: vi.fn().mockReturnValueOnce(claim).mockReturnValueOnce(saved).mockReturnValue(release), storage: { from: storageFrom } };
  const downloadMedia = vi.fn(async () => {
    if (options.providerDownload === 'not_found') throw { status: 404, message: 'Message not found' };
    if (options.providerDownload === 'error') throw new Error('private upstream detail');
    return { base64: btoa('abcd'), mimetype: 'audio/ogg; codecs=opus' };
  });
  const uazapiTranscribe = vi.fn();
  const provider = { provider: 'uazapi', downloadMedia, transcribeAudio: uazapiTranscribe };
  const transcribe = vi.fn(async (_bytes: Uint8Array, _mime: string, _budgetMs: number) => {
    if (options.slowMs) await new Promise((r) => setTimeout(r, options.slowMs));
    return 'transcript' in options ? options.transcript : 'olá, tudo bem?';
  });
  const log = vi.fn(async (_entry: Record<string, unknown>) => {});
  const run = () => transcribeChatAudio(user as unknown as SupabaseClient, admin as unknown as SupabaseClient,
    provider as unknown as WhatsAppProvider, ORG, 'instance', id,
    { transcribe, log: log as never, ...(options.budgetMs ? { budgetMs: options.budgetMs } : {}) });
  return { run, read, claim, saved, admin, download, info, storageFrom, downloadMedia, uazapiTranscribe, transcribe, log };
}

describe('on-demand transcription', () => {
  it('transcribes via the own pipeline from our Storage, persists text + provider, never calls UAZAPI transcription', async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ text: 'olá, tudo bem?', provider: 'gemini-2.5-flash', cached: false });
    expect(f.read.eq).toHaveBeenCalledWith('organization_id', ORG); expect(f.read.eq).toHaveBeenCalledWith('instance_id', 'instance');
    expect(f.storageFrom).toHaveBeenCalledWith('media');
    expect(f.download).toHaveBeenCalledWith(`whatsapp-media/${ORG}/instance/audio.ogg`);
    expect(f.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/ogg', expect.any(Number));
    expect(f.downloadMedia).not.toHaveBeenCalled();
    expect(f.uazapiTranscribe).not.toHaveBeenCalled();
    expect(f.saved.update).toHaveBeenCalledWith(expect.objectContaining({ transcription_text: 'olá, tudo bem?', transcription_provider: 'gemini-2.5-flash', transcription_created_at: expect.any(String) }));
    expect(f.saved.update.mock.calls[0][0]).not.toHaveProperty('content');
    expect(f.log).not.toHaveBeenCalled();
  });
  it.each([{ missing: true }, { denied: true }, { type: 'image' }])('rejects unavailable or unauthorized messages before any download: %o', async options => {
    const f = fixture(options); await expect(f.run()).rejects.toThrow();
    expect(f.transcribe).not.toHaveBeenCalled(); expect(f.download).not.toHaveBeenCalled(); expect(f.downloadMedia).not.toHaveBeenCalled(); expect(f.admin.from).not.toHaveBeenCalled();
  });
  it('uses persisted cache without another paid request', async () => { const f = fixture({ cached: true }); expect(await f.run()).toMatchObject({ text: 'cached', cached: true }); expect(f.transcribe).not.toHaveBeenCalled(); });
  it('rejects a concurrent claim', async () => { const f = fixture({ busy: true }); await expect(f.run()).rejects.toMatchObject({ status: 409 }); expect(f.transcribe).not.toHaveBeenCalled(); });
  it('never reads another org\'s Storage object (cross-tenant path) — falls back to the caller\'s own provider', async () => {
    const f = fixture({ mediaUrl: storageUrl(OTHER_ORG) });
    await f.run();
    expect(f.download).not.toHaveBeenCalled();
    expect(f.downloadMedia).toHaveBeenCalledWith('provider-id');
  });
  const BASE = 'https://example.supabase.co/storage/v1/object/public/media/whatsapp-media';
  it.each([
    ['encoded slash traversal', `${BASE}/${ORG}/..%2F..%2Fwhatsapp-media%2F${OTHER_ORG}%2Fx.ogg`],
    ['encoded slash, lowercase', `${BASE}/${ORG}/..%2f${OTHER_ORG}%2fx.ogg`],
    ['double-encoded dots', `${BASE}/${ORG}/%252e%252e/%252e%252e/whatsapp-media/${OTHER_ORG}/x.ogg`],
    ['encoded dots resolved by URL into another org', `${BASE}/${ORG}/%2e%2e/${OTHER_ORG}/x.ogg`],
    ['encoded dots resolved away from any org', `${BASE}/${ORG}/%2e%2e/%2e%2e/%2e%2e/x/y.ogg`],
    ['encoded backslash', `${BASE}/${ORG}/..%5C..%5C${OTHER_ORG}%5Cx.ogg`],
    ['raw backslash', `${BASE}/${ORG}/..\\..\\${OTHER_ORG}\\x.ogg`],
    ['org segment encoded', `${BASE}/${ORG.replace('4', '%34')}/instance/x.ogg`],
  ])('never reads Storage for a crafted path (%s)', async (_label, mediaUrl) => {
    const f = fixture({ mediaUrl });
    await f.run();
    expect(f.download).not.toHaveBeenCalled();
    expect(f.info).not.toHaveBeenCalled();
    expect(f.downloadMedia).toHaveBeenCalledWith('provider-id');
  });
  it('accepts the legitimate Storage path shape used in prod', async () => {
    const f = fixture({ mediaUrl: `${BASE}/${ORG}/${OTHER_ORG}/audio_1791201598543_1791201598543.mp3` });
    await f.run();
    expect(f.download).toHaveBeenCalledWith(`whatsapp-media/${ORG}/${OTHER_ORG}/audio_1791201598543_1791201598543.mp3`);
  });
  it('checks the object size before downloading it', async () => {
    const f = fixture({ infoSize: 15 * 1024 * 1024 });
    await expect(f.run()).rejects.toMatchObject({ status: 413, message: 'Este áudio é grande demais para transcrever (limite de 14 MB).' });
    expect(f.info).toHaveBeenCalledWith(`whatsapp-media/${ORG}/instance/audio.ogg`);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.log.mock.calls[0][0]).toMatchObject({ errorMessage: 'too_large' });
  });
});

describe('time budget', () => {
  it('runtime_logs: a slow transcription fails inside the budget, is logged and releases the claim', async () => {
    const f = fixture({ slowMs: 1_000, budgetMs: 20 });
    await expect(f.run()).rejects.toMatchObject({ status: 504, message: 'Não conseguimos transcrever este áudio. Tente novamente em instantes.' });
    expect(f.log.mock.calls[0][0]).toMatchObject({ errorMessage: 'timeout', entityId: id });
    expect(f.saved.update).not.toHaveBeenCalledWith(expect.objectContaining({ transcription_text: expect.anything() }));
    expect(f.admin.from).toHaveBeenCalledTimes(2);
  });
  it('passes the remaining budget to the transcriber and keeps the lease above it', async () => {
    const f = fixture();
    await f.run();
    const budget = f.transcribe.mock.calls[0][2] as number;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThanOrEqual(TRANSCRIPTION_BUDGET_MS);
    expect(TRANSCRIPTION_LEASE_MS).toBeGreaterThan(TRANSCRIPTION_BUDGET_MS + 60_000);
    expect(TRANSCRIPTION_BUDGET_MS).toBeLessThan(150_000);
  });
});

describe('fallback to provider download', () => {
  it('fallback: media_url outside our Storage uses provider.downloadMedia', async () => {
    const f = fixture({ mediaUrl: 'https://mmg.whatsapp.net/v/t62/abc.enc' });
    expect(await f.run()).toMatchObject({ text: 'olá, tudo bem?', cached: false });
    expect(f.download).not.toHaveBeenCalled();
    expect(f.downloadMedia).toHaveBeenCalledWith('provider-id');
    expect(f.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/ogg; codecs=opus', expect.any(Number));
  });
  it('fallback: Storage miss falls back to provider.downloadMedia', async () => {
    const f = fixture({ storageError: true });
    await f.run();
    expect(f.downloadMedia).toHaveBeenCalledWith('provider-id');
  });
  it('fallback: "Message not found" becomes a clear error without saving', async () => {
    const f = fixture({ mediaUrl: null, providerDownload: 'not_found' });
    await expect(f.run()).rejects.toMatchObject({ status: 502, message: 'Este áudio não está mais disponível para transcrição.' });
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.saved.update).not.toHaveBeenCalledWith(expect.objectContaining({ transcription_text: expect.anything() }));
  });
});

describe('failures are recorded in runtime_logs', () => {
  const GENERIC = 'Não conseguimos transcrever este áudio. Tente novamente em instantes.';
  it.each([
    [{ transcript: null }, 'empty_transcript', GENERIC],
    [{ transcript: '   ' }, 'empty_transcript', GENERIC],
    [{ transcript: '[O lead enviou um áudio de voz]' }, 'empty_transcript', GENERIC],
    [{ mediaUrl: null, providerDownload: 'error' as const }, 'download_failed', GENERIC],
    [{ mediaUrl: null, providerDownload: 'not_found' as const }, 'source_not_found', 'Este áudio não está mais disponível para transcrição.'],
    [{ blobSize: 15 * 1024 * 1024 }, 'too_large', 'Este áudio é grande demais para transcrever (limite de 14 MB).'],
  ])('runtime_logs: %o → %s, nothing saved, lease released, no PII', async (options, reason, message) => {
    const f = fixture(options as Options);
    await expect(f.run()).rejects.toMatchObject({ message });
    expect(f.saved.update).not.toHaveBeenCalledWith(expect.objectContaining({ transcription_text: expect.anything() }));
    expect(f.admin.from).toHaveBeenCalledTimes(2);
    expect(f.log).toHaveBeenCalledTimes(1);
    const entry = f.log.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({ organizationId: ORG, module: 'whatsapp', action: 'transcribeAudio', status: 'error', entityType: 'whatsapp_messages', entityId: id, errorMessage: reason });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('5548999990000');
    expect(serialized).not.toContain('http');
    expect(serialized).not.toContain('private upstream detail');
    expect(serialized).not.toContain('O lead enviou');
  });
});
