import { useCustomFieldCatalogue } from '@/modules/leads';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { GUIDED_RESPONSIBLE_FIELDS, GUIDED_SCALAR_FIELDS } from '@/contracts/workflows/guided-fields';
import type { GuidedRuleDraft } from '@/types/workflow';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const fields = { ...GUIDED_SCALAR_FIELDS, ...GUIDED_RESPONSIBLE_FIELDS, 'lead.tags': { label: 'Tags' }, 'lead.origin': { label: 'Origem' } };
type Field = Exclude<GuidedRuleDraft['field'], 'lead.custom'>;
// This catalogue contains only capabilities supported by the guided evaluator.
// The ordered record also makes new field types require an explicit discovery entry.
const vocabulary = {
  'lead.name': ['contato', 'pessoa'],
  'lead.company': ['empresa', 'razao social'],
  'lead.email': ['e-mail', 'correio eletronico'],
  'lead.phone': ['celular', 'fone'],
  'lead.segment': ['setor', 'ramo'],
  'lead.tags': ['etiqueta', 'marcador'],
  'lead.pre_sale_responsible_id': ['responsavel pre vendas'],
  'lead.sale_responsible_id': ['vendedor', 'vendedora', 'responsavel vendas'],
  'lead.qualification_score': ['pontuacao', 'qualificacao', 'score'],
  'lead.urgency': ['urgencia', 'prioridade'],
  'lead.faturamento': ['receita informada'],
  'lead.origin': ['procedencia', 'origem do lead'],
  'lead.utm_campaign': ['campanha'],
  'lead.utm_source': ['fonte', 'origem utm'],
  'lead.utm_medium': ['meio', 'midia'],
  'lead.utm_content': ['conteudo', 'criativo'],
  'lead.utm_term': ['termo', 'palavra chave'],
} satisfies Record<Field, string[]>;
const entries = Object.entries(vocabulary) as [Field, string[]][];
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function GuidedFieldPicker({ id, value, onChange, actorId, organizationId, custom, onCustomSelect }: {
  id: string; value: GuidedRuleDraft['field']; onChange: (field: Field) => void;
  actorId: string; organizationId: string;
  custom?: Extract<GuidedRuleDraft, { field: 'lead.custom' }>;
  onCustomSelect: (fieldId: string, fieldLabel: string, fieldType: 'text' | 'number' | 'boolean') => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { options, selected } = useCustomFieldCatalogue(actorId, organizationId, term, open, custom?.fieldId);
  const searching = term !== search.trim() || options.isPending;
  const unavailable = custom && selected.isSuccess && (!selected.data || selected.data.field_type !== custom.fieldType);
  const name = value !== 'lead.custom' ? fields[value].label : selected.isError ? 'Campo não verificado'
    : selected.isPending ? 'Consultando campo…'
    : unavailable ? 'Campo indisponível' : selected.data?.field_name || 'Campo personalizado';
  useEffect(() => {
    if (custom && selected.data?.field_type === custom.fieldType && selected.data.field_name !== custom.fieldLabel) {
      onCustomSelect(custom.fieldId, selected.data.field_name, custom.fieldType);
    }
  }, [custom, selected.data, onCustomSelect]);
  return <div className="space-y-2"><Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(''); }}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open}
        aria-haspopup="listbox" aria-controls={open ? `${id}-list` : undefined} className="w-full justify-between font-normal">
        <span className="truncate">Lead · {name}</span>
        <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
      <Command filter={(_value, search, keywords = []) => {
        const haystack = normalize(keywords.join(' '));
        return normalize(search).split(/\s+/).every(term => haystack.includes(term)) ? 1 : 0;
      }}>
        <CommandInput value={search} onValueChange={setSearch} aria-label="Buscar informação" placeholder="Buscar informação…" />
        <CommandList id={`${id}-list`} aria-label="Informações disponíveis">
          {!searching && !options.isError && !(custom && (selected.isPending || selected.isError || unavailable)) && <CommandEmpty>Nenhuma informação encontrada. Tente outro termo.</CommandEmpty>}
          {searching && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando campos personalizados…</p>}
          {options.isError && <div className="p-3"><p role="alert" className="text-sm text-destructive">Não foi possível carregar campos personalizados.</p>
            <Button type="button" variant="ghost" onClick={() => void options.refetch()}>Tentar carregar campos novamente</Button></div>}
          <CommandGroup heading="Lead">
            {entries.map(([field, aliases]) => <CommandItem key={field} value={field}
              keywords={['Lead', fields[field].label, ...aliases]} onSelect={() => {
                if (field !== value) onChange(field);
                setOpen(false); setSearch('');
              }}>
              <Check aria-hidden="true" className={`mr-2 h-4 w-4 shrink-0 ${field === value ? 'opacity-100' : 'opacity-0'}`} />
              <span>{fields[field].label}</span>
            </CommandItem>)}
          </CommandGroup>
          {!searching && !options.isError && <CommandGroup heading="Lead · Campos personalizados">
            {options.data?.filter(field => (field.field_type === 'text' || field.field_type === 'number' || field.field_type === 'boolean') && !(unavailable && field.id === custom?.fieldId)).map(field =>
              <CommandItem key={field.id} value={`custom:${field.id}`} keywords={[field.field_name]} onSelect={() => {
                onCustomSelect(field.id, field.field_name, field.field_type === 'boolean' ? 'boolean' : field.field_type === 'number' ? 'number' : 'text'); setOpen(false); setSearch('');
              }}>
                <Check aria-hidden="true" className={`mr-2 h-4 w-4 shrink-0 ${custom?.fieldId === field.id ? 'opacity-100' : 'opacity-0'}`} />
                <span>{field.field_name}</span>
              </CommandItem>)}
          </CommandGroup>}
        </CommandList>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Até 25 resultados de campos personalizados. Refine a busca pelo nome.</p>
      </Command>
    </PopoverContent>
  </Popover>
    {custom && selected.isError && <><p role="alert" className="text-sm text-destructive">Não foi possível verificar o campo selecionado.</p>
      <Button type="button" variant="outline" onClick={() => void selected.refetch()}>Tentar verificar campo novamente</Button></>}
    {custom && selected.isSuccess && !selected.data && <p role="alert" className="text-sm text-destructive">Campo removido ou sem acesso. Selecione outro campo.</p>}
    {custom && selected.data && selected.data.field_type !== custom.fieldType && <p role="alert" className="text-sm text-destructive">O tipo deste campo mudou. Selecione outra informação.</p>}
  </div>;
}
