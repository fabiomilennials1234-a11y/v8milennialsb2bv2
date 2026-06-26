import { useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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

export interface OrgOption {
  id: string;
  name: string;
}

interface OrgInsightsComboboxProps {
  orgs: OrgOption[];
  value: string | null;
  onSelect: (orgId: string) => void;
  /** hero = estado vazio (h-11, largo); compact = header (ghost). */
  variant?: "hero" | "compact";
  loading?: boolean;
  className?: string;
}

/**
 * Combobox de organização (Command + Popover). Busca por nome (~30 orgs).
 * Reusa as primitivas shadcn; o item selecionado marca com `Check` em
 * `text-insights`.
 */
export function OrgInsightsCombobox({
  orgs,
  value,
  onSelect,
  variant = "hero",
  loading = false,
  className,
}: OrgInsightsComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = orgs.find((o) => o.id === value);

  const isHero = variant === "hero";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isHero ? "outline" : "ghost"}
          role="combobox"
          aria-expanded={open}
          aria-label="Selecionar organização"
          disabled={loading}
          className={cn(
            "justify-between gap-2 font-medium",
            "focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isHero
              ? "h-11 w-full sm:w-[360px] rounded-xl border-border bg-card/60 px-4 text-[15px]"
              : "h-9 px-2.5 text-sm text-foreground/80 hover:text-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2
              className={cn(
                "shrink-0",
                isHero ? "h-[18px] w-[18px] text-insights" : "h-4 w-4 text-muted-foreground",
              )}
            />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.name ?? "Selecionar organização"}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isHero ? "center" : "start"}
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar organização…" className="h-10" />
          <CommandList>
            <CommandEmpty>Nenhuma organização encontrada.</CommandEmpty>
            <CommandGroup>
              {orgs.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.name}
                  onSelect={() => {
                    onSelect(org.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{org.name}</span>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4 text-insights",
                      org.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
