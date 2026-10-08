import { useEffect, useState } from 'react';
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
  const selectedId = condition.tagId.toLowerCase();
  const unavailable = Boolean(condition.tagId && selected.isSuccess && !selected.data);
  const choices = (options.data ?? []).filter(tag => !unavailable || tag.id.toLowerCase() !== selectedId);
  const selectedTag = selected.data;
  useEffect(() => {
    if (selected.isSuccess && selectedTag?.id.toLowerCase() === selectedId && selectedTag.name !== condition.tagLabel) {
      // Refresh display metadata only; identity and comparison remain intact.
      onChange({ ...condition, tagLabel: selectedTag.name });
    }
  }, [condition, onChange, selected.isSuccess, selectedTag, selectedId]);
  if (selectedTag) {
    const index = choices.findIndex(tag => tag.id === selectedTag.id);
    if (index >= 0) choices[index] = selectedTag;
    else choices.unshift(selectedTag);
  }
  return <div className="space-y-2">
    <Label htmlFor={`guided-tag-search-${condition.id}`}>Buscar tag</Label>
    <Input id={`guided-tag-search-${condition.id}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome da tag" />
    <Label htmlFor={`guided-value-${condition.id}`}>Tag</Label>
    <select id={`guided-value-${condition.id}`} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={selectedId} aria-invalid={unavailable || !condition.tagId} onChange={event => {
        const tag = choices.find(item => item.id === event.target.value);
        onChange({ ...condition, tagId: tag?.id ?? '', tagLabel: tag?.name });
      }}>
      <option value="">{options.isPending ? 'Carregando tags…' : 'Selecione uma tag'}</option>
      {condition.tagId && !choices.some(tag => tag.id.toLowerCase() === selectedId) && <option disabled value={selectedId}>{selected.isError && !selected.isFetching ? 'Tag não verificada' : unavailable ? 'Tag indisponível' : 'Consultando tag selecionada…'}</option>}
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
    {options.isSuccess && options.data.length === 0 && (!condition.tagId || (selected.isSuccess && Boolean(selected.data))) && <p className="text-sm text-muted-foreground">Nenhuma tag encontrada. Tente outro nome.</p>}
    {options.data?.length === 25 && <p className="text-xs text-muted-foreground">Mostrando até 25 tags. Refine a busca.</p>}
  </div>;
}
