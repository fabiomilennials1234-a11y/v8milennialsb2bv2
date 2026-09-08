import { useEffect, useState } from 'react';
import { useGuidedResponsibleOptions } from '@/modules/identity';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { GuidedResponsibleRuleDraft } from '@/types/workflow';

export function GuidedResponsiblePicker({ actorId, organizationId, condition, onChange }: {
  actorId: string; organizationId: string; condition: Extract<GuidedResponsibleRuleDraft, { memberId: string }>;
  onChange: (condition: Extract<GuidedResponsibleRuleDraft, { memberId: string }>) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { options, selected } = useGuidedResponsibleOptions(actorId, organizationId, term, condition.memberId);
  const selectedId = condition.memberId.toLowerCase();
  const unavailable = Boolean(condition.memberId && selected.isSuccess && !selected.data);
  const choices = (options.data ?? []).filter(member => !unavailable || member.id.toLowerCase() !== selectedId);
  const selectedMember = selected.data;
  useEffect(() => {
    if (selected.isSuccess && selectedMember?.id.toLowerCase() === selectedId && selectedMember.name !== condition.memberLabel) {
      // Refresh display metadata only; identity and comparison remain intact.
      onChange({ ...condition, memberLabel: selectedMember.name });
    }
  }, [condition, onChange, selected.isSuccess, selectedMember, selectedId]);
  if (selectedMember) {
    const index = choices.findIndex(member => member.id === selectedMember.id);
    if (index >= 0) choices[index] = selectedMember;
    else choices.unshift(selectedMember);
  }
  return <div className="space-y-2">
    <Label htmlFor={`guided-member-search-${condition.id}`}>Buscar responsável</Label>
    <Input id={`guided-member-search-${condition.id}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome do responsável" />
    <Label htmlFor={`guided-value-${condition.id}`}>Responsável</Label>
    <select id={`guided-value-${condition.id}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={selectedId} aria-invalid={unavailable || !condition.memberId} onChange={event => {
        const member = choices.find(item => item.id === event.target.value);
        onChange({ ...condition, memberId: member?.id ?? '', memberLabel: member?.name });
      }}>
      <option value="">{options.isPending ? 'Carregando responsáveis…' : 'Selecione um responsável'}</option>
      {condition.memberId && !choices.some(member => member.id.toLowerCase() === selectedId) && <option disabled value={selectedId}>{unavailable ? 'Responsável indisponível' : 'Consultando responsável selecionado…'}</option>}
      {choices.map(member => <option key={member.id} value={member.id}>{member.name}{member.is_active === false ? ' (inativo)' : ''}</option>)}
    </select>
    {(options.isError || (condition.memberId && selected.isError)) && <>
      <p role="alert" className="text-sm text-destructive">Não foi possível carregar responsáveis. Tente novamente.</p>
      <Button type="button" variant="outline" disabled={options.isFetching || selected.isFetching} onClick={() => {
        void options.refetch();
        if (condition.memberId) void selected.refetch();
      }}>Tentar carregar responsáveis novamente</Button>
    </>}
    {unavailable && <p role="alert" className="text-sm text-destructive">Responsável removido ou sem acesso. Selecione outro responsável.</p>}
    {options.isSuccess && options.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhum responsável encontrado. Tente outro nome.</p>}
    {options.data?.length === 25 && <p className="text-xs text-muted-foreground">Mostrando até 25 responsáveis. Refine a busca.</p>}
  </div>;
}
