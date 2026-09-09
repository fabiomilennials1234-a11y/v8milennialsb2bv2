import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFunnelOptions, type FunnelOption } from "../../lib/funnel-nav";
import { FunnelIdentityDialog } from "./FunnelIdentityDialog";

/**
 * Seletor de funil — o nome do funil vira a porta para os outros.
 *
 * Decisão do protótipo que este componente honra: **clicar no nome abre a
 * lista; escolher é que troca.** Não navega ao passar o mouse nem ao abrir —
 * trocar de funil sem querer, no meio de um arrasto ou de uma seleção, custa
 * caro pra quem trabalha o board o dia inteiro.
 *
 * A lista é ÚNICA. Havia três blocos rotulados (Estruturais / Customizados /
 * Com prazo); funil não tem mais espécie. `option.group` continua no dado
 * porque ele diz de onde a linha veio, mas não vira mais rótulo na tela.
 */

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
  const [renomeando, setRenomeando] = useState(false);
  const navigate = useNavigate();
  const { options, isLoading } = useFunnelOptions();

  const current = options.find((o) => o.key === currentKey);
  const label = current?.label ?? fallbackLabel;
  const color = current?.color ?? fallbackColor;

  // O `sort` era por bloco; achatando, ele tem de ser global — senão funil
  // encerrado, que antes ia pro fim do bloco "Com prazo", cairia no meio da
  // lista. Encerrado é o único critério de ordem que sobrou, e é estado.
  const items = [...options].sort(
    (a, b) => Number(a.ended ?? false) - Number(b.ended ?? false),
  );

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
        {!isLoading && items.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">Nenhum funil disponível</p>
        )}
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

        {/* Renomear o funil ABERTO, a partir do próprio nome dele.
            O clique no nome continua abrindo a lista — a decisão do protótipo
            (escolher é que troca) fica de pé, e o título não vira campo
            editável. O que muda é que a identidade deixou de morar só na
            sétima aba de Configurações. */}
        {current?.pipeline && (
          <>
            <div className="my-1 h-px bg-border" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setRenomeando(true);
              }}
              data-testid="funnel-switcher-rename"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Pencil className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Renomear "{label}"</span>
            </button>
          </>
        )}
      </PopoverContent>

      {current?.pipeline && (
        <FunnelIdentityDialog
          open={renomeando}
          onOpenChange={setRenomeando}
          pipeline={current.pipeline}
          displayName={label}
        />
      )}
    </Popover>
  );
});
