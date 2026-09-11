import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { WhatsAppProvider } from './whatsapp-client.ts';
import { isChatTargetAllowed } from './chat-owner-guard.ts';
export class TranscriptionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function transcribeChatAudio(user: SupabaseClient, admin: SupabaseClient,
  provider: WhatsAppProvider, organizationId: string, instanceId: string, rowId: unknown) {
  if (typeof rowId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId)) throw new TranscriptionError(400, 'Mensagem inválida');
  const { data: message, error } = await user.from('whatsapp_messages')
    .select('id,message_id,phone_number,message_type,deleted_at,transcription_text,transcription_provider,transcription_created_at')
    .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).maybeSingle();
  if (error || !message || message.deleted_at) throw new TranscriptionError(404, 'Mensagem indisponível');
  if (!await isChatTargetAllowed(user, organizationId, instanceId, { leadId: null, rawPhone: message.phone_number, messageId: message.message_id })) {
    throw new TranscriptionError(403, 'Conversa indisponível');
  }
  if (!['audio', 'ptt'].includes(message.message_type)) throw new TranscriptionError(400, 'Selecione uma mensagem de áudio');
  if (message.transcription_text && message.transcription_provider && message.transcription_created_at) return {
    text: message.transcription_text, provider: message.transcription_provider, createdAt: message.transcription_created_at, cached: true,
  };
  if (!provider.transcribeAudio) throw new TranscriptionError(422, 'Transcrição indisponível neste provedor');
  const now = new Date().toISOString();
  const expired = new Date(Date.now() - 120_000).toISOString();
  const { data: claim, error: claimError } = await admin.from('whatsapp_messages').update({ transcription_requested_at: now })
    .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).is('deleted_at', null)
    .is('transcription_text', null).or(`transcription_requested_at.is.null,transcription_requested_at.lt.${expired}`).select('id').maybeSingle();
  if (claimError) throw new TranscriptionError(503, 'Não foi possível iniciar a transcrição');
  if (!claim) throw new TranscriptionError(409, 'Transcrição já solicitada. Aguarde e tente novamente.');
  try {
    const text = await provider.transcribeAudio(message.message_id);
    const createdAt = new Date().toISOString();
    const { data: saved, error: saveError } = await admin.from('whatsapp_messages').update({
      transcription_text: text, transcription_provider: provider.provider, transcription_created_at: createdAt, transcription_requested_at: null,
    }).eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId)
      .eq('transcription_requested_at', now).is('deleted_at', null).select('id').maybeSingle();
    if (saveError || !saved) throw new Error('Persistence failed');
    return { text, provider: provider.provider, createdAt, cached: false };
  } catch {
    throw new TranscriptionError(502, 'Não foi possível transcrever este áudio. Tente novamente.');
  } finally {
    await admin.from('whatsapp_messages').update({ transcription_requested_at: null })
      .eq('id', rowId).eq('organization_id', organizationId).eq('instance_id', instanceId).eq('transcription_requested_at', now);
  }
}
