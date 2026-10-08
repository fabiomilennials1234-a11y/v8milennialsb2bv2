import { useId, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { ClosedOutcome, ClosedOutcomeGroup } from "@/modules/pipelines/lib/closed-outcome-groups";

/**
 * Tom de cada desfecho. Classes por extenso: o Tailwind só gera o que encontra
 * literal no código. Mesmos tokens do card encerrado (`--success` /
 * `--destructive`), para o grupo e os cards dentro dele lerem como uma coisa só.
 */
const TONE: Record<ClosedOutcome, {
  label: string;
  singular: string;
  Icon: typeof Check;
  icon: string;
  stack: string;
  layer: string;
  panel: string;
  text: string;
}> = {
  won: {
    label: "Ganhos",
    singular: "ganho",
    Icon: Check,
    icon: "bg-success/15 text-success ring-1 ring-inset ring-success/30",
    stack: "border-success/40 bg-[linear-gradient(hsl(var(--success)/0.08),hsl(var(--success)/0.08))] hover:border-success/70",
    layer: "border-success/25",
    panel: "border-success/25 bg-success/[0.035]",
    text: "text-success",
  },
  lost: {
    label: "Perdidos",
    singular: "perdido",
    Icon: X,
    icon: "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30",
    stack: "border-destructive/40 bg-[linear-gradient(hsl(var(--destructive)/0.08),hsl(var(--destructive)/0.08))] hover:border-destructive/70",
    layer: "border-destructive/25",
    panel: "border-destructive/25 bg-destructive/[0.035]",
    text: "text-destructive",
  },
};

function countLabel(n: number, outcome: ClosedOutcome): string {
  if (outcome === "won") return n === 1 ? "negócio ganho" : "negócios ganhos";
  return n === 1 ? "negócio perdido" : "negócios perdidos";
}

export interface ClosedOutcomeStackProps<T> {
  group: ClosedOutcomeGroup<T>;
  expanded: boolean;
  openMonths: ReadonlySet<string>;
  onToggleExpanded: () => void;
  onToggleMonth: (monthKey: string) => void;
  onOpenAllMonths: () => void;
  renderItem: (item: T) => ReactNode;
  /**
   * A coluna ainda tem página por carregar: o grupo pode crescer. Só marca a
   * contagem com "+"; carregar mais é da coluna, num lugar só.
   */
  hasMore?: boolean;
}

/**
 * Os negócios ganhos (ou perdidos) de uma etapa, empilhados.
 *
 * Fechado: um baralho — o card da frente diz quantos são e quanto somam, e as
 * bordas atrás dele dizem que há mais de um. Aberto: um subgrupo por mês do
 * desfecho; cada mês abre independente, então dá para ter setembro e agosto
 * abertos lado a lado, ou todos os meses ("Abrir todos") para a lista completa.
 * "Agrupar" devolve ao baralho.
 */
export function ClosedOutcomeStack<T extends { id: string }>({
  group,
  expanded,
  openMonths,
  onToggleExpanded,
  onToggleMonth,
  onOpenAllMonths,
  renderItem,
  hasMore,
}: ClosedOutcomeStackProps<T>) {
  const tone = TONE[group.outcome];
  const reduceMotion = useReducedMotion();
  const panelId = useId();
  const count = group.items.length;
  // "12+" quando a coluna ainda não carregou tudo: o grupo mostra o que tem,
  // sem fingir que é o total da etapa.
  const countText = `${count}${hasMore ? "+" : ""}`;
  const monthsText = group.months.length === 1 ? group.months[0].label : `${group.months.length} meses`;
  const allOpen = group.months.every((m) => openMonths.has(m.key));
  const layers = Math.min(count - 1, 2);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={false}
        aria-label={`${countText} ${countLabel(count, group.outcome)} — abrir lista`}
        data-testid={`closed-stack-${group.outcome}`}
        className={cn(
          "group/stack relative block w-full text-left",
          "rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          layers === 2 ? "mb-3" : layers === 1 ? "mb-1.5" : "",
        )}
      >
        {/* Bordas do baralho: cards por trás do da frente. Puramente visuais. */}
        {layers >= 2 && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-3.5 -bottom-[11px] h-5 rounded-lg border bg-card/60",
              "transition-transform duration-200 ease-out group-hover/stack:translate-y-0.5",
              tone.layer,
            )}
          />
        )}
        {layers >= 1 && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-[7px] -bottom-[6px] h-5 rounded-lg border bg-card/90",
              "transition-transform duration-200 ease-out group-hover/stack:translate-y-px",
              tone.layer,
            )}
          />
        )}
        <span
          className={cn(
            "relative flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5",
            "shadow-[0_1px_2px_hsl(var(--foreground)/0.06)] transition-colors duration-200",
            tone.stack,
          )}
        >
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", tone.icon)} aria-hidden>
            <tone.Icon className="size-3.5" strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-semibold tabular-nums tracking-[-0.01em]">{countText}</span>
              <span className="truncate text-[12px] font-medium text-foreground/80">
                {count === 1 && !hasMore ? tone.singular : tone.label.toLowerCase()}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              {group.total !== null && (
                <>
                  <span className={cn("font-medium tabular-nums", tone.text)}>{formatBRL(group.total)}</span>
                  <span aria-hidden className="text-muted-foreground/50">·</span>
                </>
              )}
              <span className="truncate">{monthsText}</span>
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover/stack:translate-x-0.5"
          />
        </span>
      </button>
    );
  }

  return (
    <section
      id={panelId}
      aria-label={`${tone.label} — ${countText} ${countLabel(count, group.outcome)}`}
      data-testid={`closed-group-${group.outcome}`}
      className={cn("rounded-lg border p-1", tone.panel)}
    >
      <header className="flex items-center gap-1.5 pb-1 pl-1.5 pr-0.5 pt-0.5">
        <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", tone.icon)} aria-hidden>
          <tone.Icon className="size-3" strokeWidth={2.5} />
        </span>
        <span className="text-[12px] font-semibold tracking-[-0.01em]">{tone.label}</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-muted-foreground">
          {countText}
        </span>
        <span className="ml-auto flex shrink-0 items-center">
          {group.months.length > 1 && !allOpen && (
            <button
              type="button"
              onClick={onOpenAllMonths}
              title="Abrir todos os meses"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronsUpDown className="size-3" aria-hidden />
              Abrir todos
            </button>
          )}
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded
            aria-controls={panelId}
            title="Agrupar novamente"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronsDownUp className="size-3" aria-hidden />
            Agrupar
          </button>
        </span>
      </header>

      <div className="space-y-0.5">
        {group.months.map((month) => {
          const open = openMonths.has(month.key);
          const monthPanelId = `${panelId}-${month.key}`;
          return (
            <div key={month.key}>
              <button
                type="button"
                onClick={() => onToggleMonth(month.key)}
                aria-expanded={open}
                aria-controls={monthPanelId}
                data-testid={`closed-month-${group.outcome}-${month.key}`}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left",
                  "transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  open && "bg-foreground/[0.04]",
                )}
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                    !open && "-rotate-90",
                  )}
                />
                <span className="truncate text-[11.5px] font-medium">{month.label}</span>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">{month.items.length}</span>
                {month.total !== null && (
                  <span className={cn("ml-auto text-[10.5px] font-medium tabular-nums", tone.text)}>
                    {formatBRL(month.total)}
                  </span>
                )}
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={monthPanelId}
                    key="cards"
                    initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 px-0.5 pb-1.5 pt-1">
                      {month.items.map((item) => renderItem(item))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
