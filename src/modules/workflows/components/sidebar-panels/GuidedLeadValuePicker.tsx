import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useGuidedLeadValues } from '../../hooks/useGuidedLeadValues';
import { ValueCombobox } from './ValueCombobox';

export function GuidedLeadValuePicker({ id, actorId, organizationId, field, value, onChange, errorMessage = 'Não foi possível carregar sugestões deste campo.' }: {
  errorMessage?: string; id: string; actorId: string; organizationId: string; field: string; value: string; onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const query = useGuidedLeadValues(actorId, organizationId, field, term);
  return <div className="space-y-2"><ValueCombobox id={id} value={value} onChange={onChange} onSearchChange={setSearch}
    values={query.isError ? [] : query.data ?? []} isLoading={query.isPending}
    emptyMessage={query.isError ? 'Sugestões indisponíveis — digite um valor manualmente.' : 'Nenhum valor encontrado nesta org — digite manualmente.'} />
    {query.isError && <><p role="alert" className="text-sm text-destructive">{errorMessage}</p>
      <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Tentar carregar sugestões novamente</Button></>}
    {field === 'faturamento' && <p className="text-xs text-muted-foreground">Faturamento informado pode ser uma faixa. A comparação considera o texto registrado.</p>}
    <p className="text-xs text-muted-foreground">Sugestões limitadas. Refine a busca ou digite outro valor.</p>
  </div>;
}
