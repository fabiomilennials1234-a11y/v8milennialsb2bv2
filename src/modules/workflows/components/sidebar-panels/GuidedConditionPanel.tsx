import { GUIDED_SCALAR_FIELDS } from '@/contracts/workflows/guided-fields';
import { GuidedConditionResult, type GuidedResultEntry } from './GuidedConditionResult';
import { GuidedConditionBuilder, isIncompleteGuidedDraft } from './GuidedConditionBuilder';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/shared/hooks/useDebounce';

import type { GuidedConditionDraft } from '@/types/workflow';

export function GuidedConditionPanel({ actorId, organizationId, condition, onChange }: {
  actorId: string;
  organizationId: string;
  condition: GuidedConditionDraft;
  onChange: (condition: GuidedConditionDraft) => void;
}) {
  const [leadId, setLeadId] = useState('');
  const [search, setSearch] = useState('');
  const searchTerm = useDebounce(search.trim(), 250);
  const [result, setResult] = useState<{ fingerprint: string; matched: boolean; actual: unknown; rules: GuidedResultEntry[]; groups: GuidedResultEntry[] } | null>(null);
  const fingerprint = JSON.stringify({ actorId, organizationId, leadId, condition });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const missingValue = isIncompleteGuidedDraft(condition);
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
  async function test() {
    if (missingValue || !leadId || pending) return;
    setPending(true);
    setResult(null);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('test-guided-condition', {
        body: { organizationId, leadId, condition },
      });
      if (error || data?.status !== 'evaluated') {
        const failure = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : data;
        setError(failure?.code === 'access_denied'
          ? 'Você não tem acesso aos dados necessários para este teste.'
          : failure?.code === 'reference_unavailable'
          ? 'Uma referência foi removida ou não está acessível. Revise as escolhas da condição.'
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
      <Button type="button" disabled={!leadId || pending || missingValue} onClick={test}>{pending ? 'Avaliando…' : 'Testar condição'}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result?.fingerprint === fingerprint && <div role="status" className="rounded-lg border border-border p-3 text-sm"><strong>{result.matched ? 'Sim' : 'Não'}</strong>{('children' in condition || condition.field === 'lead.origin') ? <GuidedConditionResult condition={condition} rules={result.rules} groups={result.groups} /> : condition.field === 'lead.tags' ? <p>{result.rules[0]?.reference?.name ?? 'Tag'}: {result.actual === true ? 'atribuída' : result.actual === false ? 'não atribuída' : 'Resultado indisponível'}</p> : <p>{GUIDED_SCALAR_FIELDS[condition.field].actualLabel}: {result.actual == null ? 'Vazio' : String(result.actual)}</p>}</div>}
    </section>
  </div>;
}
