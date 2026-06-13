import { useState } from "react";
import { ListFilter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ALL_ORIGINS, ORIGIN_LABELS } from "@/modules/analytics/hooks/useMktOriginConfig";

interface SaudeOriginFilterProps {
  value: string[];
  onChange: (origins: string[]) => void;
}

/**
 * Filtro multi-origem da aba Saúde — popover compacto (variante V3 aprovada).
 * Vazio = todas as origens; a coorte é refeita no backend via p_origins.
 */
export function SaudeOriginFilter({ value, onChange }: SaudeOriginFilterProps) {
  const [open, setOpen] = useState(false);

  const toggle = (origin: string) => {
    onChange(
      value.includes(origin) ? value.filter((o) => o !== origin) : [...value, origin]
    );
  };

  const label =
    value.length === 0
      ? "Todas as origens"
      : value.length <= 2
        ? value.map((o) => ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS] ?? o).join(", ")
        : `${value.length} origens`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium",
            "transition-colors hover:bg-muted/60",
            value.length > 0 && "border-primary/40 text-foreground"
          )}
        >
          <ListFilter className="h-3.5 w-3.5 opacity-60" />
          {label}
          {value.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-extrabold text-primary-foreground">
              {value.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Buscar origem…" />
          <CommandList>
            <CommandEmpty>Nenhuma origem encontrada.</CommandEmpty>
            <CommandGroup>
              {ALL_ORIGINS.map((origin) => (
                <CommandItem
                  key={origin}
                  value={ORIGIN_LABELS[origin]}
                  onSelect={() => toggle(origin)}
                  className="gap-2.5"
                >
                  <Checkbox
                    checked={value.includes(origin)}
                    className="pointer-events-none h-4 w-4"
                  />
                  {ORIGIN_LABELS[origin]}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-xs font-semibold text-primary hover:bg-muted/50"
            >
              <X className="h-3 w-3" />
              Limpar filtro
            </button>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
