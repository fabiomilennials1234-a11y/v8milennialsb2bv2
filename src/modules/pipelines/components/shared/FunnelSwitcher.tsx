import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useFunnelOptions,
  FUNNEL_GROUP_LABEL,
  type FunnelGroup,
  type FunnelOption,
} from "../../lib/funnel-nav";

/**
 * Seletor de funil — o nome do funil vira a porta para os outros.
 *
 * Decisão do protótipo que este componente honra: **clicar no nome abre a
 * lista; escolher é que troca.** Não navega ao passar o mouse nem ao abrir —
 * trocar de funil sem querer, no meio de um arrasto ou de uma seleção, custa
 * caro pra quem trabalha o board o dia inteiro.
 */

const GROUP_ORDER: FunnelGroup[] = ["estrutural", "custom", "prazo"];

interface FunnelSwitcherProps {
  /** Chave do funil aberto: `sys:whatsapp`, `custom:<id>`… */
  currentKey: string;
  /** Nome exibido enquanto a lista carrega (o da página). */
  fallbackLabel: string;
  fallbackColor?: string;
}

export const FunnelSwitcher = memo(function FunnelSwitcher({
  currentKey,
  fallbackLabel,
  fallbackColor = "#64748b",
}: FunnelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { options, isLoading } = useFunnelOptions();

  const current = options.find((o) => o.key === currentKey);
  const label = current?.label ?? fallbackLabel;
  const color = current?.color ?? fallbackColor;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: options
      .filter((o) => o.group === group)
      .sort((a, b) => Number(a.ended ?? false) - Number(b.ended ?? false)),
  })).filter((g) => g.items.length > 0);

  const go = (option: FunnelOption) => {
    setOpen(false);
    if (option.key !== currentKey) navigate(option.path);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="funnel-switcher"
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Trocar de funil"
          className={cn(
            "group inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5",
            "text-[19px] font-semibold tracking-[-0.02em]",
            "hover:bg-muted/60 transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
          <span className="truncate">{label}</span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 max-h-[70vh] overflow-y-auto p-1.5">
        {isLoading && (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">Carregando funis…</p>
        )}
        {!isLoading && grouped.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">Nenhum funil disponível</p>
        )}
        {grouped.map(({ group, items }) => (
          <div key={group} className="mb-1 last:mb-0">
            <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {FUNNEL_GROUP_LABEL[group]}
            </p>
            {items.map((option) => {
              const active = option.key === currentKey;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => go(option)}
                  data-testid={`funnel-switcher-option-${option.key}`}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                    "hover:bg-muted/70 transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-primary/10 font-semibold",
                    option.ended && "opacity-55",
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: option.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.ended && (
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">encerrado</span>
                  )}
                  {active && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
});
