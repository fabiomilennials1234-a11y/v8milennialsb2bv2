import { useState } from 'react';
import { useTagOptions } from '@/modules/leads';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { GuidedTagRuleDraft } from '@/types/workflow';

export function GuidedTagPicker({ actorId, organizationId, condition, onChange }: {
  actorId: string; organizationId: string; condition: GuidedTagRuleDraft;
  onChange: (condition: GuidedTagRuleDraft) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { options, selected } = useTagOptions(actorId, organizationId, term, condition.tagId);
  const choices = [...(options.data ?? [])];
  const selectedTag = selected.data;
  if (selectedTag && !choices.some(tag => tag.id === selectedTag.id)) choices.unshift(selectedTag);
  const unavailable = Boolean(condition.tagId && selected.isSuccess && !selected.data);
  return <div className="space-y-2">
    <Label htmlFor={`guided-tag-search-${condition.id}`}>Buscar tag</Label>
    <Input id={`guided-tag-search-${condition.id}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome da tag" />
    <Label htmlFor={`guided-value-${condition.id}`}>Tag</Label>
    <select id={`guided-value-${condition.id}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={condition.tagId} aria-invalid={unavailable || !condition.tagId} onChange={event => {
        const tag = choices.find(item => item.id === event.target.value);
        onChange({ ...condition, tagId: tag?.id ?? '', tagLabel: tag?.name });
      }}>
      <option value="">{options.isPending ? 'Carregando tags…' : 'Selecione uma tag'}</option>
      {condition.tagId && !choices.some(tag => tag.id === condition.tagId) && <option value={condition.tagId}>{unavailable ? 'Tag indisponível' : 'Consultando tag selecionada…'}</option>}
      {choices.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
    </select>
    {(options.isError || (condition.tagId && selected.isError)) && <>
      <p role="alert" className="text-sm text-destructive">Não foi possível carregar tags. Tente novamente.</p>
      <Button type="button" variant="outline" disabled={options.isFetching || selected.isFetching} onClick={() => {
        void options.refetch();
        if (condition.tagId) void selected.refetch();
      }}>Tentar carregar tags novamente</Button>
    </>}
    {unavailable && <p role="alert" className="text-sm text-destructive">Tag removida ou sem acesso. Selecione outra tag.</p>}
    {options.isSuccess && options.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tag encontrada. Tente outro nome.</p>}
    {options.data?.length === 25 && <p className="text-xs text-muted-foreground">Mostrando até 25 tags. Refine a busca.</p>}
  </div>;
}
