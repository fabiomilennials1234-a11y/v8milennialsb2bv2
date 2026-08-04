import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ValueComboboxProps {
  /** Valores distintos que já existem na org (deduplicados + ordenados). */
  values: string[];
  /** Valor atual (`data.value`). Pode ser um item da lista ou texto livre. */
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  /** Texto do estado vazio — varia por origem dos valores (UTM, campo custom, ...). */
  emptyMessage?: string;
}

/**
 * Combobox creatable (Command + Popover) para o "Valor" do node de condição.
 * Lista valores REAIS da org e SEMPRE permite digitar valor livre — o estado
 * vazio nunca pode bloquear o input.
 *
 * Serve dois campos, e pela mesma razão nos dois: o valor gravado no lead não é
 * o que o humano escreveria de cabeça. UTM vem do Meta com pontuação/acento
 * (`[TESTE CRIATIVOS] BATERIA.`); campo personalizado vem do formulário
 * slugificado (`barril_de_chopp`, `ainda_não_sei`). Digitar de memória erra, e o
 * erro é silencioso — a condição só devolve `false` pra sempre.
 *
 * Reusa o padrão visual de ProductCombobox/OrgInsightsCombobox.
 */
export function ValueCombobox({
  values,
  value,
  onChange,
  isLoading = false,
  placeholder = "Selecione ou digite um valor",
  emptyMessage = "Nenhum valor encontrado nesta org — digite manualmente.",
}: ValueComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const term = search.trim();
  const filtered = term
    ? values.filter((v) => v.toLowerCase().includes(term.toLowerCase()))
    : values;

  // Só oferece "criar" quando há texto que não bate EXATAMENTE com um item.
  const hasExactMatch = values.some((v) => v === term);
  const showCreate = term.length > 0 && !hasExactMatch;

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar ou digitar valor…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando valores…
              </div>
            ) : (
              <>
                {values.length === 0 && !showCreate && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    {emptyMessage}
                  </div>
                )}

                {filtered.length > 0 && (
                  <CommandGroup>
                    {filtered.map((v) => (
                      <CommandItem key={v} value={v} onSelect={() => commit(v)}>
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 shrink-0",
                            value === v ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{v}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {showCreate && (
                  <CommandGroup>
                    <CommandItem
                      value={`__create__${term}`}
                      onSelect={() => commit(term)}
                    >
                      <Plus className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">Usar "{term}"</span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
