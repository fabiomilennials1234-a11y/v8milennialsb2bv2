/**
 * OriginSelect — combobox de origem do lead a partir da lista gerenciável por
 * org (lead_origins). Admins podem criar uma origem nova inline; membros só
 * escolhem das existentes. value/onChange trafegam o slug (gravado em
 * leads.origin, que agora é text).
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useIdentity } from "@/modules/identity";
import {
  useLeadOrigins,
  useCreateLeadOrigin,
  slugifyOrigin,
} from "../../../hooks/useLeadOrigins";
import { getOriginLabel } from "@/lib/lead/lead-origins";

interface OriginSelectProps {
  value?: string | null;
  onChange: (slug: string) => void;
  className?: string;
  triggerClassName?: string;
  placeholder?: string;
  allowCreate?: boolean;
  disabled?: boolean;
}

export function OriginSelect({
  value,
  onChange,
  className,
  triggerClassName,
  placeholder = "Selecione a origem",
  allowCreate = true,
  disabled = false,
}: OriginSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: origins = [], isLoading } = useLeadOrigins();
  const { isAdmin } = useIdentity();
  const createOrigin = useCreateLeadOrigin();

  const canCreate = allowCreate && isAdmin;

  const current = useMemo(
    () => origins.find((o) => o.slug === value),
    [origins, value],
  );

  const currentLabel = current?.name ?? (value ? getOriginLabel(value) : "");

  const trimmed = query.trim();
  const exactExists = origins.some(
    (o) => o.name.toLowerCase() === trimmed.toLowerCase() || o.slug === slugifyOrigin(trimmed),
  );
  const showCreate = canCreate && trimmed.length > 0 && !exactExists;

  const handleCreate = async () => {
    if (!trimmed) return;
    try {
      const created = await createOrigin.mutateAsync({ name: trimmed });
      onChange(created.slug);
      setQuery("");
      setOpen(false);
      toast.success(`Origem "${created.name}" criada`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao criar origem";
      toast.error(msg);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", triggerClassName)}
        >
          <span className="flex items-center gap-2 truncate">
            {current && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: current.color }}
              />
            )}
            <span className={cn("truncate", !currentLabel && "text-muted-foreground")}>
              {currentLabel || placeholder}
            </span>
          </span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[--radix-popover-trigger-width] p-0", className)} align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Buscar origem…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {showCreate ? (
                    <button
                      type="button"
                      onClick={handleCreate}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                      disabled={createOrigin.isPending}
                    >
                      {createOrigin.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Criar "{trimmed}"
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Nenhuma origem encontrada
                    </span>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {origins.map((o) => (
                    <CommandItem
                      key={o.id}
                      value={o.name}
                      onSelect={() => {
                        onChange(o.slug);
                        setQuery("");
                        setOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: o.color }}
                      />
                      <span className="truncate">{o.name}</span>
                      {value === o.slug && (
                        <Check className="w-4 h-4 ml-auto text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {showCreate && origins.length > 0 && (
                  <CommandGroup>
                    <CommandItem
                      value={`__create__${trimmed}`}
                      onSelect={handleCreate}
                      className="flex items-center gap-2 text-primary"
                    >
                      {createOrigin.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Criar "{trimmed}"
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
