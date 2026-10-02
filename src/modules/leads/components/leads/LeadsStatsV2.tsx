import type { KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Users, CalendarDays, UserCheck, X, type LucideIcon } from "lucide-react";
import { KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";

/**
 * Faixa de números da tela de Leads — V5 (`KpiTile`).
 *
 * O que vem da versão anterior e continua valendo:
 * - o número é o protagonista, o rótulo é legenda;
 * - cada cartão ganha **contexto**: "este mês" sozinho é um número solto;
 *   "12% do total entraram este mês" é uma leitura. A barra embaixo é a mesma
 *   proporção, pra bater o olho sem ler;
 * - **cartão é controle, não decoração**: clicar aplica o filtro que ele conta
 *   (Linear faz isso nos insights; Stripe nos tiles de disputa). O cartão ativo
 *   ganha anel dourado e o ícone vira um "×" pra desfazer.
 *
 * O cartão de rating saiu junto com o filtro de rating da página (main de
 * 2026-09); os três que ficam seguem `useLeadsStats` + `useLeadsCount`.
 */
export interface LeadsStatsV2Props {
  total: number;
  thisMonth: number;
  withOwner: number;
  isLoading?: boolean;
  /** Filtros que os cards controlam. Sem handler, o card é só leitura. */
  filters?: {
    thisMonth?: { active: boolean; toggle: () => void };
    unassigned?: { active: boolean; toggle: () => void };
  };
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "neutral" | "gold" | "good";
  /** Proporção 0–1 em relação ao total; `undefined` = sem barra. */
  share?: number;
  context: string;
  filter?: { active: boolean; toggle: () => void; hint: string };
}

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function share(part: number, total: number): number | undefined {
  if (!total) return undefined;
  return Math.min(1, Math.max(0, part / total));
}

const EASE = [0.2, 0, 0, 1] as const;

const BAR: Record<Tile["tone"], string> = {
  neutral: "bg-foreground/60",
  gold: "bg-primary",
  good: "bg-success",
};

export function LeadsStatsV2({ total, thisMonth, withOwner, isLoading, filters }: LeadsStatsV2Props) {
  const reduce = useReducedMotion();
  const semDono = Math.max(0, total - withOwner);

  const tiles: Tile[] = [
    {
      key: "total",
      label: "Total de leads",
      value: total,
      icon: Users,
      tone: "neutral",
      context: "Na organização, com os filtros atuais",
    },
    {
      key: "mes",
      label: "Este mês",
      value: thisMonth,
      icon: CalendarDays,
      tone: "gold",
      share: share(thisMonth, total),
      context: total ? `${pf.format(thisMonth / total)} do total entraram este mês` : "Entraram este mês",
      filter: filters?.thisMonth && { ...filters.thisMonth, hint: "Filtrar por criados este mês" },
    },
    {
      key: "dono",
      label: "Com responsável",
      value: withOwner,
      icon: UserCheck,
      tone: "good",
      share: share(withOwner, total),
      context: total ? `${nf.format(semDono)} sem dono` : "Nenhum sem dono",
      filter: filters?.unassigned && { ...filters.unassigned, hint: "Mostrar só os sem dono" },
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map((t, i) => {
        const clickable = !!t.filter;
        const active = !!t.filter?.active;
        const onKeyDown = clickable
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                t.filter!.toggle();
              }
            }
          : undefined;

        return (
          <KpiTile
            key={t.key}
            label={t.label}
            value={isLoading ? "·" : nf.format(t.value)}
            loading={isLoading}
            // Ativo: o ícone vira o "×" que desfaz, no chip de ouro.
            icon={active ? X : t.icon}
            tone={active ? "gold" : t.tone}
            note={isLoading ? " " : t.context}
            // O cartão É o botão: `role` + teclado, sem envelopar <div> em
            // <button> (conteúdo em bloco dentro de botão é HTML inválido).
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-pressed={clickable ? active : undefined}
            // `KpiTile` tira `title` do TIPO (o nome está ocupado pelo rótulo),
            // mas repassa o atributo ao <div>: é a dica nativa de hover.
            {...{ title: clickable ? (active ? "Remover filtro" : t.filter!.hint) : undefined }}
            onClick={clickable ? t.filter!.toggle : undefined}
            onKeyDown={onKeyDown}
            className={cn(
              clickable &&
                "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active && "ring-2 ring-primary/70",
            )}
          >
            {t.share !== undefined && (
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${pf.format(t.share)} do total`}
              >
                <motion.div
                  className={cn("h-full rounded-full", BAR[t.tone])}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(isLoading ? 0 : t.share) * 100}%` }}
                  transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : 0.15 + i * 0.04 }}
                />
              </div>
            )}
          </KpiTile>
        );
      })}
    </div>
  );
}
