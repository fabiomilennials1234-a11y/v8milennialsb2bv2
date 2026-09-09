import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useCustomFieldCatalogue } from '@/modules/leads';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Search is forgiving; persisted option identity is the exact registered string. */
export function GuidedCustomOptionPicker({ actorId, organizationId, fieldId, id, value, onChange }: {
  actorId: string; organizationId: string; fieldId: string; id: string; value: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { selected } = useCustomFieldCatalogue(actorId, organizationId, '', false, fieldId);
  const raw = selected.data?.field_options;
  const valid = selected.isSuccess && selected.data?.field_type === 'select'
    && (raw === null || (Array.isArray(raw) && raw.every(option => typeof option === 'string' && option.length > 0)));
  const options = valid && Array.isArray(raw) ? [...new Set(raw as string[])] : [];
  const matches = options.filter(option => normalize(option).includes(normalize(search)));
  const missing = Boolean(value) && valid && !options.includes(value);
  const unavailable = selected.isSuccess && !valid;
  const label = selected.isPending ? 'Consultando opções…' : selected.isError ? 'Opções não verificadas'
    : unavailable ? 'Opções indisponíveis' : missing ? 'Opção removida' : value || 'Selecione uma opção';
  return <div className="space-y-2">
    <Label htmlFor={id}>Valor da comparação</Label>
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(''); }}>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open}
        aria-haspopup="dialog" aria-invalid={!value || missing || unavailable}
        disabled={selected.isPending || selected.isError || unavailable} className="w-full justify-between font-normal">
        <span className="truncate">{label}</span><ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput aria-label="Buscar opção cadastrada" placeholder="Buscar opção…" value={search} onValueChange={setSearch} />
          <CommandList label="Opções cadastradas">
            <CommandGroup>{matches.slice(0, 25).map(option => <CommandItem key={option} value={option}
              onSelect={() => { onChange(option); setOpen(false); setSearch(''); }}>
              <Check aria-hidden="true" className={`mr-2 h-4 w-4 shrink-0 ${value === option ? 'opacity-100' : 'opacity-0'}`} />{option}
            </CommandItem>)}</CommandGroup>
            {!matches.length && <p className="px-3 py-2 text-sm text-muted-foreground">{options.length ? 'Nenhuma opção encontrada. Tente outro termo.' : 'Este campo não tem opções cadastradas.'}</p>}
          </CommandList>
          {matches.length > 25 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Mostrando 25 opções. Refine a busca.</p>}
        </Command>
      </PopoverContent>
    </Popover>
    {selected.isError && <><p role="alert" className="text-sm text-destructive">Não foi possível verificar as opções cadastradas.</p>
      <Button type="button" variant="outline" onClick={() => void selected.refetch()}>Tentar verificar opções novamente</Button></>}
    {unavailable && <p role="alert" className="text-sm text-destructive">Opções indisponíveis. Verifique o cadastro deste campo.</p>}
    {missing && <p role="alert" className="text-sm text-destructive">A opção selecionada foi removida. Selecione uma opção cadastrada.</p>}
    {!value && valid && <p className="text-xs text-muted-foreground">Escolha uma opção ou use “está vazio”.</p>}
  </div>;
}
