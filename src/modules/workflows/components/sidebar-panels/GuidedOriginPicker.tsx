import { useEffect, useState } from 'react';
import { useLeadOriginOptions } from '@/modules/leads';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { GuidedOriginRuleDraft } from '@/types/workflow';

export function GuidedOriginPicker({ actorId, organizationId, condition, onChange }: {
  actorId: string; organizationId: string; condition: Extract<GuidedOriginRuleDraft, { originId: string }>;
  onChange: (condition: Extract<GuidedOriginRuleDraft, { originId: string }>) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { options, selected } = useLeadOriginOptions(actorId, organizationId, term, condition.originId);
  const selectedId = condition.originId.toLowerCase();
  const unavailable = Boolean(condition.originId && selected.isSuccess && !selected.data);
  const choices = (options.data ?? []).filter(origin => !unavailable || origin.id.toLowerCase() !== selectedId);
  const selectedOrigin = selected.data;
  useEffect(() => {
    if (selected.isSuccess && selectedOrigin?.id.toLowerCase() === selectedId && selectedOrigin.name !== condition.originLabel) {
      // Refresh display metadata only; identity and comparison remain intact.
      onChange({ ...condition, originLabel: selectedOrigin.name });
    }
  }, [condition, onChange, selected.isSuccess, selectedOrigin, selectedId]);
  if (selectedOrigin) {
    const index = choices.findIndex(origin => origin.id === selectedOrigin.id);
    if (index >= 0) choices[index] = selectedOrigin;
    else choices.unshift(selectedOrigin);
  }
  return <div className="space-y-2">
    <Label htmlFor={`guided-origin-search-${condition.id}`}>Buscar origem</Label>
    <Input id={`guided-origin-search-${condition.id}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome da origem" />
    <Label htmlFor={`guided-value-${condition.id}`}>Origem</Label>
    <select id={`guided-value-${condition.id}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={selectedId} aria-invalid={unavailable || !condition.originId} onChange={event => {
        const origin = choices.find(item => item.id === event.target.value);
        onChange({ ...condition, originId: origin?.id ?? '', originLabel: origin?.name });
      }}>
      <option value="">{options.isPending ? 'Carregando origens…' : 'Selecione uma origem'}</option>
      {condition.originId && !choices.some(origin => origin.id.toLowerCase() === selectedId) && <option disabled value={selectedId}>{unavailable ? 'Origem indisponível' : 'Consultando origem selecionada…'}</option>}
      {choices.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.is_active === false ? ' (inativa)' : ''}</option>)}
    </select>
    {(options.isError || (condition.originId && selected.isError)) && <>
      <p role="alert" className="text-sm text-destructive">Não foi possível carregar origens. Tente novamente.</p>
      <Button type="button" variant="outline" disabled={options.isFetching || selected.isFetching} onClick={() => {
        void options.refetch();
        if (condition.originId) void selected.refetch();
      }}>Tentar carregar origens novamente</Button>
    </>}
    {unavailable && <p role="alert" className="text-sm text-destructive">Origem removida ou sem acesso. Selecione outra origem.</p>}
    {options.isSuccess && options.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma origem encontrada. Tente outro nome.</p>}
    {options.data?.length === 25 && <p className="text-xs text-muted-foreground">Mostrando até 25 origens. Refine a busca.</p>}
  </div>;
}
