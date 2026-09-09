import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { GuidedMessagePeriodRuleDraft, GuidedMessageSearchRuleDraft, GuidedTriggerMessageTextRuleDraft } from '@/types/workflow';
import { Label } from '@/components/ui/label';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Rule = GuidedTriggerMessageTextRuleDraft | GuidedMessagePeriodRuleDraft | GuidedMessageSearchRuleDraft;
type Box = { storage: 'whatsapp_messages' | 'channel_messages'; id: string; provider: string; label: string };

export function GuidedConversationPicker({ actorId, organizationId, condition, onChange, triggerOnly = false }: {
  actorId: string; organizationId: string; condition: Rule; onChange: (condition: Rule) => void; triggerOnly?: boolean;
}) {
  const boxes = useQuery({
    queryKey: ['workflows', organizationId, 'guided-conversation-boxes', actorId],
    enabled: condition.conversation.kind === 'explicit', staleTime: 30_000,
    queryFn: async (): Promise<Box[]> => {
      const [whatsapp, social] = await Promise.all([
        supabase.from('whatsapp_instances').select('id, instance_name, provider').eq('organization_id', organizationId).order('instance_name'),
        supabase.from('messaging_channels').select('id, display_name, provider, channel_type').eq('organization_id', organizationId).order('display_name'),
      ]);
      if (whatsapp.error) throw whatsapp.error;
      if (social.error) throw social.error;
      return [
        ...(whatsapp.data ?? []).map(row => ({ id: row.id, label: row.instance_name, provider: row.provider?.trim() || 'uazapi',
          storage: row.provider === 'notificame' ? 'channel_messages' as const : 'whatsapp_messages' as const })),
        ...(social.data ?? []).map(row => ({ id: row.id, label: `${row.display_name} · ${row.channel_type}`, provider: row.provider,
          storage: 'channel_messages' as const })),
      ];
    },
  });
  const selected = condition.conversation.kind === 'explicit'
    ? `${condition.conversation.storage}:${condition.conversation.boxId}:${condition.conversation.provider}` : '';
  return <div className="space-y-2">
    <Label htmlFor={`guided-conversation-${condition.id}`}>Conversa</Label>
    <select id={`guided-conversation-${condition.id}`} className={selectClass} value={condition.conversation.kind}
      onChange={event => onChange({ ...condition, conversation: event.target.value === 'explicit'
        ? { kind: 'explicit', storage: 'whatsapp_messages', boxId: '', provider: '' } : { kind: 'trigger' } })}>
      <option value="trigger">Conversa que iniciou o fluxo</option>
      {!triggerOnly && <option value="explicit">Caixa específica</option>}
    </select>
    {condition.conversation.kind === 'explicit' && <>
      <Label htmlFor={`guided-box-${condition.id}`}>Caixa de entrada</Label>
      <select id={`guided-box-${condition.id}`} className={selectClass} value={selected} disabled={boxes.isPending}
        onChange={event => {
          const box = boxes.data?.find(item => `${item.storage}:${item.id}:${item.provider}` === event.target.value);
          if (box) onChange({ ...condition, conversation: { kind: 'explicit', storage: box.storage, boxId: box.id, provider: box.provider, boxLabel: box.label } });
        }}>
        <option value="">{boxes.isPending ? 'Carregando caixas…' : 'Selecione uma caixa'}</option>
        {boxes.data?.map(box => <option key={`${box.storage}:${box.id}`} value={`${box.storage}:${box.id}:${box.provider}`}>{box.label} · {box.provider}</option>)}
      </select>
      {boxes.isError && <p role="alert" className="text-xs text-destructive">Não foi possível carregar suas caixas acessíveis.</p>}
      <p className="text-xs text-muted-foreground">O participante será o lead desta execução. Outra caixa nunca substitui esta seleção.</p>
    </>}
  </div>;
}
