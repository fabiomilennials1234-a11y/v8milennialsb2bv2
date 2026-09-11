import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, FileText } from 'lucide-react';
import { useInstanceCapabilities } from '../../../hooks/useInstanceCapabilities';
import { transcribeAudio } from '../../../lib/whatsappApi';
import type { WhatsAppMessage } from '../../../hooks/chat/types';

export function AudioTranscription({ message }: { message: WhatsAppMessage }) {
  const client = useQueryClient();
  const { canUseUazapiActions } = useInstanceCapabilities(message.instance_id);
  const mutation = useMutation({ mutationFn: () => transcribeAudio(message.instance_id!, message.id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['whatsapp_messages', message.organization_id] }),
  });
  const missingTranscript = mutation.error instanceof Error && mutation.error.message.includes('A UAZAPI retornou este áudio sem transcrição.');
  const text = message.transcription_provider && message.transcription_created_at ? message.transcription_text : mutation.data?.text;
  if (text) return <div className="mt-2 border-t border-current/15 pt-2 max-w-sm" aria-label="Transcrição do áudio">
    <span className="text-[10px] uppercase tracking-wide opacity-60">Transcrição</span>
    <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
  </div>;
  if (!canUseUazapiActions || !message.instance_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.id)) return null;
  return <div className="mt-2">
    <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}
      className="inline-flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 disabled:opacity-50">
      {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
      {mutation.isPending ? 'Transcrevendo…' : 'Transcrever áudio'}
    </button>
    {mutation.isError && <p role="alert" className="mt-1 text-xs">{missingTranscript ? 'A UAZAPI retornou este áudio sem transcrição. Nenhum texto foi salvo.' : 'Não foi possível transcrever. Aguarde e tente novamente.'}</p>}
  </div>;
}
