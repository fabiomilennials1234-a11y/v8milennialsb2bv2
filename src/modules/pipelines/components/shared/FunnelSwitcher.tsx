import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useFunnelOptions, type FunnelOption } from "../../lib/funnel-nav";
import { funilIcon } from "../../lib/funil-icons";
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
 *
 * V5: o gatilho É o título da página — 28 px extrabold, com o ícone e a cor
 * que o usuário escolheu num chip tintado à esquerda. O ícone saiu da faixa
 * de filtros (onde ficava solto ao lado de "Filtros") e veio morar no nome.
 */

interface FunnelSwitcherProps {
  /** Chave do funil aberto: `pipeline:<id>`. */
  currentKey: string;
  /** Nome exibido enquanto a lista carrega (o da página). */
  fallbackLabel: string;
  fallbackColor?: string;
  /** Ícone (`pipelines.icon`) enquanto a lista carrega. */
  fallbackIcon?: string | null;
}

export const FunnelSwitcher = memo(function FunnelSwitcher({
  currentKey,
  fallbackLabel,
  fallbackColor = "#64748b",
  fallbackIcon,
}: FunnelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const navigate = useNavigate();
  const { options, isLoading } = useFunnelOptions();

  const current = options.find((o) => o.key === currentKey);
  const label = current?.label ?? fallbackLabel;
  const color = current?.color ?? fallbackColor;
  const Icone = funilIcon(current?.pipeline?.icon ?? fallbackIcon);

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
            "group -ml-1.5 inline-flex min-w-0 max-w-full items-center gap-3 rounded-2xl py-1 pl-1.5 pr-2.5 text-left",
            "transition-colors duration-150 hover:bg-card/80 data-[state=open]:bg-card/80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {/* Ícone e cor do funil — tinta translúcida sobre a bancada. */}
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[14px] max-sm:size-9"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
            aria-hidden
          >
            <Icone className="size-5" style={{ color }} />
          </span>
          <span className="min-w-0 truncate text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground max-sm:text-[1.375rem]">
            {label}
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover:text-foreground",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 max-h-[70vh] overflow-y-auto p-1.5">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Funis
        </p>
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
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px]",
                "hover:bg-muted/70 transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-primary-soft font-semibold text-primary-soft-foreground hover:bg-primary-soft",
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
              {active && <Check className="size-3.5 shrink-0" aria-hidden />}
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
            <div className="my-1.5 h-px bg-border" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setRenomeando(true);
              }}
              data-testid="funnel-switcher-rename"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px]",
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
