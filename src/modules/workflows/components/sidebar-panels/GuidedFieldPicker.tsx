import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { GUIDED_RESPONSIBLE_FIELDS, GUIDED_SCALAR_FIELDS } from '@/contracts/workflows/guided-fields';
import type { GuidedRuleDraft } from '@/types/workflow';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const fields = { ...GUIDED_SCALAR_FIELDS, ...GUIDED_RESPONSIBLE_FIELDS, 'lead.tags': { label: 'Tags' }, 'lead.origin': { label: 'Origem' } };
type Field = GuidedRuleDraft['field'];
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

export function GuidedFieldPicker({ id, value, onChange }: {
  id: string; value: Field; onChange: (field: Field) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open}
        aria-haspopup="listbox" aria-controls={open ? `${id}-list` : undefined} className="w-full justify-between font-normal">
        <span className="truncate">Lead · {fields[value].label}</span>
        <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
      <Command filter={(_value, search, keywords = []) => {
        const haystack = normalize(keywords.join(' '));
        return normalize(search).split(/\s+/).every(term => haystack.includes(term)) ? 1 : 0;
      }}>
        <CommandInput aria-label="Buscar informação" placeholder="Buscar informação…" />
        <CommandList id={`${id}-list`} aria-label="Informações disponíveis">
          <CommandEmpty>Nenhuma informação encontrada. Tente outro termo.</CommandEmpty>
          <CommandGroup heading="Lead">
            {entries.map(([field, aliases]) => <CommandItem key={field} value={field}
              keywords={['Lead', fields[field].label, ...aliases]} onSelect={() => {
                if (field !== value) onChange(field);
                setOpen(false);
              }}>
              <Check aria-hidden="true" className={`mr-2 h-4 w-4 shrink-0 ${field === value ? 'opacity-100' : 'opacity-0'}`} />
              <span>{fields[field].label}</span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
