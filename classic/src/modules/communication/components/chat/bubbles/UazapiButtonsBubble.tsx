import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function QuestionChatImage({ messageId, organizationId }: { messageId: string; organizationId: string }) {
  const preview = useQuery({
    queryKey: ['workflow-question-chat-image', organizationId, messageId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('workflow-question-image', { body: { action: 'chat_preview', messageId } });
      if (error || typeof data?.previewUrl !== 'string') throw new Error('Imagem indisponível');
      return data.previewUrl as string;
    },
    staleTime: 240_000, refetchInterval: 240_000, retry: false,
  });
  if (preview.isError) return <p role="status" className="text-xs opacity-70">Imagem indisponível</p>;
  if (!preview.data) return <p role="status" className="text-xs opacity-70">Carregando imagem…</p>;
  return <img src={preview.data} alt="Imagem da pergunta" loading="lazy" className="max-h-80 w-full rounded-lg object-contain" />;
}

export function UazapiButtonsBubble({ text, options, imageMessageId, organizationId }: { text: string; options: string[]; imageMessageId?: string; organizationId?: string }) {
  return <div className="space-y-3 text-sm">
    {imageMessageId && organizationId && <QuestionChatImage messageId={imageMessageId} organizationId={organizationId} />}
    <p className="whitespace-pre-wrap break-words">{text}</p>
    <ul aria-label="Botões da mensagem" className="space-y-1.5 border-t border-current/15 pt-2">
      {options.map((option, index) => <li key={index} className="rounded-lg border border-current/20 bg-background/15 px-3 py-2 text-center font-medium break-words">{option}</li>)}
    </ul>
  </div>;
}
