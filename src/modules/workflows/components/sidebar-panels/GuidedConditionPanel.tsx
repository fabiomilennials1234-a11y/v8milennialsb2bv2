import { GUIDED_SCALAR_FIELDS } from '@/contracts/workflows/guided-fields';
import { GuidedConditionResult, type GuidedResultEntry } from './GuidedConditionResult';
import { GuidedConditionBuilder, isIncompleteGuidedDraft } from './GuidedConditionBuilder';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/shared/hooks/useDebounce';

import type { GuidedConditionDraft } from '@/types/workflow';
import { getGuidedConditionFields } from '../../lib/guided-condition-summary';

const database: SupabaseClient = supabase;
type MessageRule = Extract<import('@/types/workflow').GuidedRuleDraft, { field: 'message.trigger.text' | 'message.period.exists' | 'message.search.text' | 'message.waiting.elapsed' }>;
type MessageCandidate = { message_id: string; storage: 'whatsapp_messages' | 'channel_messages'; box_id: string;
  provider: string; participant_id: string; text_preview: string | null; text_source: string | null; message_type: string; message_at: string };
function firstMessageRule(condition: GuidedConditionDraft): MessageRule | null {
  if ('kind' in condition && condition.kind === 'business_exists') return null;
  if ('children' in condition) return condition.children.map(firstMessageRule).find(Boolean) ?? null;
  return !('kind' in condition) && (condition.field === 'message.trigger.text' || condition.field === 'message.period.exists' || condition.field === 'message.search.text' || condition.field === 'message.waiting.elapsed') ? condition : null;
}
function needsTriggerBusiness(condition: GuidedConditionDraft): boolean {
  if ('kind' in condition && condition.kind === 'business_exists') return false;
  if ('children' in condition) return condition.children.some(needsTriggerBusiness);
  return condition.field.startsWith('business.trigger.')
    || (condition.field === 'activity.follow_up' && condition.relation === 'trigger_business');
}

export function GuidedConditionPanel({ actorId, organizationId, condition, onChange }: {
  actorId: string;
  organizationId: string;
  condition: GuidedConditionDraft;
  onChange: (condition: GuidedConditionDraft) => void;
}) {
  const [leadId, setLeadId] = useState('');
  const [entryId, setEntryId] = useState('');
  const [messageId, setMessageId] = useState('');
  const [search, setSearch] = useState('');
  const searchTerm = useDebounce(search.trim(), 250);
  const [result, setResult] = useState<{ fingerprint: string; matched: boolean; actual: unknown; rules: GuidedResultEntry[]; groups: GuidedResultEntry[] } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const missingValue = isIncompleteGuidedDraft(condition);
  const requiresTriggerBusiness = needsTriggerBusiness(condition);
  const messageRule = firstMessageRule(condition);
  const requiresMessageCandidate = messageRule?.field === 'message.trigger.text' || messageRule?.conversation.kind === 'trigger';
  const messageConversationReady = !messageRule || messageRule.conversation.kind === 'trigger'
    || Boolean(messageRule.conversation.boxId && messageRule.conversation.provider);
  const fingerprint = JSON.stringify({ actorId, organizationId, leadId, entryId, messageId, condition });
  const leads = useQuery({
    queryKey: ['guided-condition-leads', actorId, organizationId, searchTerm],
    enabled: Boolean(actorId && organizationId),
    queryFn: async ({ signal }) => {
      let query = supabase.from('leads').select('id, name')
        .eq('organization_id', organizationId).is('deleted_at', null).order('name').limit(25).abortSignal(signal);
      if (searchTerm) query = query.ilike('name', `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  const businesses = useQuery({
    queryKey: ['guided-condition-businesses', actorId, organizationId, leadId],
    enabled: Boolean(actorId && organizationId && leadId && requiresTriggerBusiness),
    queryFn: async ({ signal }) => {
      const { data: entries, error: entryError } = await supabase.from('pipeline_entries').select('id, pipeline_id, stage_id')
        .eq('organization_id', organizationId).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(25).abortSignal(signal);
      if (entryError) throw entryError;
      const pipelineIds = [...new Set((entries ?? []).map(entry => entry.pipeline_id))];
      const stageIds = [...new Set((entries ?? []).map(entry => entry.stage_id).filter((id): id is string => Boolean(id)))];
      const pipelineResponse = pipelineIds.length
        ? await supabase.from('pipelines').select('id, name').eq('organization_id', organizationId).in('id', pipelineIds).abortSignal(signal)
        : { data: [], error: null };
      if (pipelineResponse.error) throw pipelineResponse.error;
      const stageResponse = stageIds.length
        ? await supabase.from('pipeline_stages').select('id, name').eq('organization_id', organizationId).in('id', stageIds).abortSignal(signal)
        : { data: [], error: null };
      if (stageResponse.error) throw stageResponse.error;
      const pipelineNames = new Map((pipelineResponse.data ?? []).map(pipeline => [pipeline.id, pipeline.name]));
      const stageNames = new Map((stageResponse.data ?? []).map(stage => [stage.id, stage.name]));
      return (entries ?? []).map(entry => ({ id: entry.id,
        label: `${pipelineNames.get(entry.pipeline_id) ?? 'Funil indisponível'} · ${entry.stage_id ? stageNames.get(entry.stage_id) ?? 'Etapa indisponível' : 'Sem etapa'}` }));
    },
  });
  const messages = useQuery({
    queryKey: ['guided-condition-messages', actorId, organizationId, leadId, messageRule?.conversation],
    enabled: Boolean(actorId && organizationId && leadId && messageRule && messageConversationReady && requiresMessageCandidate),
    queryFn: async (): Promise<MessageCandidate[]> => {
      const explicit = messageRule!.conversation.kind === 'explicit' ? messageRule!.conversation : null;
      const response = await database.rpc('test_guided_condition_message_candidates', {
        p_organization_id: organizationId, p_lead_id: leadId, p_storage: explicit?.storage ?? null,
        p_box_id: explicit?.boxId || null, p_provider: explicit?.provider || null,
      });
      if (response.error) throw response.error;
      return response.data as unknown as MessageCandidate[];
    },
  });
  useEffect(() => { setEntryId(''); }, [actorId, organizationId, leadId, requiresTriggerBusiness]);
  useEffect(() => { setMessageId(''); }, [actorId, organizationId, leadId, messageRule?.conversation]);
  async function test() {
    if (missingValue || !leadId || (requiresTriggerBusiness && !entryId) || (requiresMessageCandidate && !messageId) || pending) return;
    setPending(true);
    setResult(null);
    setError('');
    try {
      const message = messages.data?.find(candidate => candidate.message_id === messageId);
      const { data, error } = await supabase.functions.invoke('test-guided-condition', {
        body: { organizationId, leadId, ...(requiresTriggerBusiness ? { entryId } : {}), ...(message ? { messageContext: {
          storage: message.storage, messageId: message.message_id, boxId: message.box_id,
          provider: message.provider, participantId: message.participant_id,
        } } : {}), condition },
      });
      if (error || data?.status !== 'evaluated') {
        const failure = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : data;
        setError(failure?.code === 'access_denied'
          ? 'Você não tem acesso aos dados necessários para este teste.'
          : failure?.code === 'reference_unavailable'
          ? 'Uma referência foi removida ou não está acessível. Revise as escolhas da condição.'
          : failure?.code === 'message_text_unavailable'
          ? 'Esta mídia não possui legenda nem transcrição persistida. A condição não gerou conteúdo novo.'
          : failure?.code === 'history_sync_in_progress'
          ? getGuidedConditionFields(condition).includes('message.waiting.elapsed')
            ? 'A sincronização desta conversa ainda está em andamento. O relógio será confiável quando o histórico terminar.'
            : 'A sincronização desta conversa ainda está em andamento. O teste será confiável quando a cobertura do período terminar.'
          : failure?.code === 'history_insufficient'
          ? getGuidedConditionFields(condition).includes('message.waiting.elapsed')
            ? 'Histórico insuficiente para localizar o início da espera. Sincronize a conversa antes de decidir.'
            : 'Histórico insuficiente para concluir Sim ou Não neste período. Sincronize a conversa ou ajuste o intervalo.'
          : 'Não foi possível avaliar esta condição. Verifique seu acesso e tente novamente.');
      } else {
        setResult({ fingerprint, matched: data.matched, actual: data.rules[0]?.actual, rules: data.rules, groups: data.groups ?? [] });
      }
    } catch {
      setError('Teste indisponível. Tente novamente.');
    } finally {
      setPending(false);
    }
  }
  const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return <div className="space-y-6">
    <div className="space-y-1"><h3 className="text-lg font-semibold tracking-tight">Quando esta condição for atendida</h3>
      <p className="text-sm text-muted-foreground">Escolha uma informação e defina a comparação.</p></div>
    <GuidedConditionBuilder actorId={actorId} organizationId={organizationId} condition={condition} onChange={onChange} />
    <section className="space-y-3 rounded-xl border border-border bg-muted/20 p-4" aria-label="Teste da condição">
      <div><h4 className="font-medium">Confira com um lead</h4><p className="text-xs text-muted-foreground">Consulta dados atuais, sem executar ações.</p></div>
      <Label htmlFor="guided-search-lead">Buscar lead</Label>
      <Input id="guided-search-lead" placeholder="Buscar pelo nome" value={search} onChange={event => { setSearch(event.target.value); setLeadId(''); }} />
      <Label htmlFor="guided-test-lead">Lead para testar</Label>
      <select id="guided-test-lead" className={selectClass} value={leadId} onChange={event => setLeadId(event.target.value)}>
        <option value="">{leads.isPending ? 'Carregando leads…' : 'Selecione um lead'}</option>
        {leads.data?.map(lead => <option key={lead.id} value={lead.id}>{lead.name}</option>)}
      </select>
      {leads.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar leads.</p>}
      {leads.isSuccess && leads.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lead encontrado. Tente outro nome.</p>}
      {requiresTriggerBusiness && <>
        <Label htmlFor="guided-test-business">Negócio do gatilho</Label>
        <select id="guided-test-business" className={selectClass} value={entryId} disabled={!leadId || businesses.isPending || businesses.isError}
          onChange={event => setEntryId(event.target.value)}>
          <option value="">{businesses.isPending && leadId ? 'Carregando negócios…' : 'Selecione o negócio que disparou'}</option>
          {businesses.data?.map(business => <option key={business.id} value={business.id}>{business.label}</option>)}
        </select>
        {businesses.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os negócios deste lead.</p>}
        {businesses.isSuccess && businesses.data.length === 0 && <p className="text-sm text-muted-foreground">Este lead não possui negócio disponível.</p>}
      </>}
      {requiresMessageCandidate && <>
        <Label htmlFor="guided-test-message">Mensagem que simula o gatilho</Label>
        <select id="guided-test-message" className={selectClass} value={messageId} disabled={!leadId || messages.isPending || messages.isError}
          onChange={event => setMessageId(event.target.value)}>
          <option value="">{messages.isPending && leadId ? 'Carregando mensagens acessíveis…' : 'Selecione uma mensagem'}</option>
          {messages.data?.map(message => <option key={message.message_id} value={message.message_id}>{new Date(message.message_at).toLocaleString('pt-BR')} · {message.text_preview || `[${message.message_type} sem texto]`} · {message.provider}</option>)}
        </select>
        {messages.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar mensagens desta conversa.</p>}
        {messages.isSuccess && messages.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem acessível nesta conversa.</p>}
      </>}
      <Button type="button" disabled={!leadId || (requiresTriggerBusiness && !entryId) || Boolean(requiresMessageCandidate && !messageId) || pending || missingValue} onClick={test}>{pending ? 'Avaliando…' : 'Testar condição'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result?.fingerprint === fingerprint && <div role="status" className="rounded-lg border border-border p-3 text-sm"><strong>{result.matched ? 'Sim' : 'Não'}</strong>{('children' in condition || condition.field === 'lead.custom' || condition.field === 'lead.origin' || condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id' || condition.field === 'business.trigger.stage' || condition.field === 'business.trigger.value' || condition.field === 'business.trigger.stage_elapsed' || condition.field === 'business.last_won_date' || condition.field === 'message.trigger.text' || condition.field === 'message.period.exists' || condition.field === 'message.search.text' || condition.field === 'message.waiting.elapsed' || condition.field === 'activity.follow_up') ? <GuidedConditionResult condition={condition} rules={result.rules} groups={result.groups} /> : condition.field === 'lead.tags' ? <p>{result.rules[0]?.reference && 'name' in result.rules[0].reference ? result.rules[0].reference.name : 'Tag'}: {result.actual === true ? 'atribuída' : result.actual === false ? 'não atribuída' : 'Resultado indisponível'}</p> : <p>{GUIDED_SCALAR_FIELDS[condition.field].actualLabel}: {result.actual == null ? 'Vazio' : String(result.actual)}</p>}</div>}
    </section>
  </div>;
}
