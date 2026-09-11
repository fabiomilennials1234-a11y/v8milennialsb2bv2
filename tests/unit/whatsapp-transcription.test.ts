import { describe, it, expect, vi } from 'vitest';
import { transcribeChatAudio } from '../../supabase/functions/_shared/whatsapp-transcription';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppProvider } from '../../supabase/functions/_shared/whatsapp-client';
const id = '11111111-1111-4111-8111-111111111111';
function fixture(options: { missing?: boolean; denied?: boolean; cached?: boolean; busy?: boolean; failure?: boolean; type?: string } = {}) {
 const message = { id, message_id: 'provider-id', phone_number: 'controlled', message_type: options.type ?? 'audio', ...(options.cached ? { transcription_text: 'cached', transcription_provider: 'uazapi', transcription_created_at: '2026-09-11T00:00:00Z' } : {}) };
 const chain = (data: unknown) => { const b = { select: vi.fn(() => b), eq: vi.fn(() => b), is: vi.fn(() => b), or: vi.fn(() => b), update: vi.fn(() => b), maybeSingle: vi.fn(async () => ({ data, error: null })), then: (fn: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(fn) }; return b; };
 const read = chain(options.missing ? null : message), claim = chain(options.busy ? null : { id }), saved = chain({ id }), release = chain(null);
 const user = { from: vi.fn(() => read), rpc: vi.fn(async () => ({ data: !options.denied, error: null })) };
 const admin = { from: vi.fn().mockReturnValueOnce(claim).mockReturnValueOnce(saved).mockReturnValue(release) };
 const transcribeAudio = options.failure ? vi.fn().mockRejectedValue(new Error('private upstream detail')) : vi.fn().mockResolvedValue('hello');
 const provider = { provider: 'uazapi', transcribeAudio };
 const run = () => transcribeChatAudio(user as unknown as SupabaseClient, admin as unknown as SupabaseClient, provider as unknown as WhatsAppProvider, 'org', 'instance', id);
 return { run, read, claim, saved, transcribeAudio, admin };
}
describe('on-demand transcription', () => {
 it('persists text with provenance, without replacing message content', async () => {
  const f=fixture();expect(await f.run()).toMatchObject({ text: 'hello', provider: 'uazapi', cached: false });
  expect(f.read.eq).toHaveBeenCalledWith('organization_id','org'); expect(f.read.eq).toHaveBeenCalledWith('instance_id','instance');
  expect(f.saved.update).toHaveBeenCalledWith(expect.objectContaining({ transcription_text:'hello',transcription_provider:'uazapi',transcription_created_at:expect.any(String) }));
  expect(f.saved.update.mock.calls[0][0]).not.toHaveProperty('content');
 });
 it.each([{missing:true},{denied:true},{type:'image'}])('rejects unavailable or unauthorized messages before provider call: %o', async options => {
  const f=fixture(options);await expect(f.run()).rejects.toThrow();expect(f.transcribeAudio).not.toHaveBeenCalled();expect(f.admin.from).not.toHaveBeenCalled();
 });
 it('uses persisted cache without another paid request', async()=>{const f=fixture({cached:true});expect(await f.run()).toMatchObject({text:'cached',cached:true});expect(f.transcribeAudio).not.toHaveBeenCalled();});
 it('rejects a concurrent claim',async()=>{const f=fixture({busy:true});await expect(f.run()).rejects.toMatchObject({status:409});expect(f.transcribeAudio).not.toHaveBeenCalled();});
 it('sanitizes provider errors and releases the lease',async()=>{const f=fixture({failure:true});await expect(f.run()).rejects.toMatchObject({status:502});expect(f.admin.from).toHaveBeenCalledTimes(2);});
});

it('explains missing provider transcription without saving text or leaking response details', async () => {
 const f=fixture();f.transcribeAudio.mockRejectedValue({ provider_code: 'transcription_missing', message: 'private upstream detail' });
 await expect(f.run()).rejects.toMatchObject({ status: 502, message: 'A UAZAPI retornou este áudio sem transcrição. Nenhum texto foi salvo.' });
 expect(f.saved.update).not.toHaveBeenCalledWith(expect.objectContaining({ transcription_text: expect.anything() }));
 expect(f.admin.from).toHaveBeenCalledTimes(2);
});
