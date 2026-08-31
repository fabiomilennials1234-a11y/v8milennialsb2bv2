import type { ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Users, Sparkles, CalendarDays, UserCheck, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Faixa de números da tela de Leads — versão "Depois".
 *
 * O que muda em relação aos `.stat-card`:
 * - o número é o protagonista (28px, tabular, tracking negativo), o rótulo é
 *   caption — na versão anterior os dois tinham quase o mesmo peso;
 * - cada card ganha **contexto**: "alta qualidade" sozinho é um número solto;
 *   "alta qualidade · 23% do total" é uma leitura. A barra embaixo é a mesma
 *   proporção, pra bater o olho sem ler;
 * - a tinta some de onde não significa nada: o trilho dourado em quatro cards
 *   iguais era decoração. Fica só no card do mês, que é o único com recorte
 *   temporal — o resto usa o ícone como âncora e a barra como cor;
 * - **card é controle, não decoração**: clicar aplica o filtro que ele conta
 *   (Linear faz isso nos insights; Stripe nos tiles de disputa). O card ativo
 *   ganha borda dourada e um "×" pra desfazer.
 *
 * Referências: Linear (insights — número grande + caption + proporção),
 * Stripe (tiles do dashboard — hierarquia por peso, não por cor).
 */
export interface LeadsStatsV2Props {
  total: number;
  highRating: number;
  thisMonth: number;
  withOwner: number;
  isLoading?: boolean;
  /** Filtros que os cards controlam. Sem handler, o card é só leitura. */
  filters?: {
    highRating?: { active: boolean; toggle: () => void };
    thisMonth?: { active: boolean; toggle: () => void };
    unassigned?: { active: boolean; toggle: () => void };
  };
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  /** Proporção 0–1 em relação ao total; `undefined` = sem barra. */
  share?: number;
  context: string;
  accent?: "primary" | "success" | "warning";
  filter?: { active: boolean; toggle: () => void; hint: string };
}

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function share(part: number, total: number): number | undefined {
  if (!total) return undefined;
  return Math.min(1, Math.max(0, part / total));
}

const EASE = [0.2, 0, 0, 1] as const;

export function LeadsStatsV2({ total, highRating, thisMonth, withOwner, isLoading, filters }: LeadsStatsV2Props) {
  const reduce = useReducedMotion();
  const semDono = Math.max(0, total - withOwner);

  const tiles: Tile[] = [
    {
      key: "total",
      label: "Total de leads",
      value: total,
      icon: Users,
      context: "na organização, com os filtros atuais",
    },
    {
      key: "alta",
      label: "Alta qualidade",
      value: highRating,
      icon: Sparkles,
      share: share(highRating, total),
      context: total ? `${pf.format(highRating / total)} do total · rating 7+` : "rating 7+",
      accent: "warning",
      filter: filters?.highRating && { ...filters.highRating, hint: "Filtrar por rating alto" },
    },
    {
      key: "mes",
      label: "Este mês",
      value: thisMonth,
      icon: CalendarDays,
      share: share(thisMonth, total),
      context: total ? `${pf.format(thisMonth / total)} do total entraram este mês` : "entraram este mês",
      accent: "primary",
      filter: filters?.thisMonth && { ...filters.thisMonth, hint: "Filtrar por criados este mês" },
    },
    {
      key: "dono",
      label: "Com responsável",
      value: withOwner,
      icon: UserCheck,
      share: share(withOwner, total),
      context: total ? `${nf.format(semDono)} sem dono` : "nenhum sem dono",
      accent: "success",
      filter: filters?.unassigned && { ...filters.unassigned, hint: "Mostrar só os sem dono" },
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t, i) => {
        const Icon = t.icon;
        const bar =
          t.accent === "primary"
            ? "bg-primary"
            : t.accent === "success"
              ? "bg-success"
              : t.accent === "warning"
                ? "bg-warning"
                : "bg-foreground/60";
        const clickable = !!t.filter;
        const active = !!t.filter?.active;
        const Tag = clickable ? motion.button : motion.div;

        return (
          <Tag
            key={t.key}
            type={clickable ? "button" : undefined}
            onClick={clickable ? t.filter!.toggle : undefined}
            aria-pressed={clickable ? active : undefined}
            title={clickable ? (active ? "Remover filtro" : t.filter!.hint) : undefined}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE, delay: reduce ? 0 : i * 0.04 }}
            className={cn(
              "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 text-left",
              "transition-[border-color,background-color] duration-150",
              active ? "border-primary/60 bg-primary/[0.04]" : "border-border",
              clickable && !active && "hover:border-muted-foreground/30 cursor-pointer",
              clickable && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {t.label}
              </span>
              {active ? (
                <span
                  aria-hidden="true"
                  className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <X className="size-3" />
                </span>
              ) : (
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 text-muted-foreground/70 transition-colors duration-150 group-hover:text-foreground/80",
                    t.accent === "primary" && "text-primary/80 group-hover:text-primary",
                  )}
                />
              )}
            </div>

            {isLoading ? (
              <Skeleton className="h-8 w-20 rounded-md" />
            ) : (
              <span className="text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-foreground">
                {nf.format(t.value)}
              </span>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="truncate text-xs text-muted-foreground" title={t.context}>
                {isLoading ? " " : t.context}
              </span>
              {t.share !== undefined && (
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${pf.format(t.share)} do total`}
                >
                  <motion.div
                    className={cn("h-full rounded-full", bar)}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${(isLoading ? 0 : t.share) * 100}%` }}
                    transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : 0.15 + i * 0.04 }}
                  />
                </div>
              )}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
