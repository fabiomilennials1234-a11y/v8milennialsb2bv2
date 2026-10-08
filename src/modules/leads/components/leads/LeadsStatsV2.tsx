import type * as React from "react";
import type { KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Users, UserPlus, UserCheck, UserX, X, type LucideIcon } from "lucide-react";
import { KpiRow, KpiTile, ValueUnit, type Tone } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCappedCount, LEADS_COUNT_CAP, type CappedCount } from "../../lib/capped-count";

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
 * 2026-09). Os quatro (V5, como no mockup) seguem `useLeadsStats` +
 * `useLeadsCount`: "sem responsável" é `total − com dono`, a mesma conta que
 * a nota do cartão anterior já fazia.
 *
 * ── CONTAGEM COM TETO (2026-10-05) ────────────────────────────────────────
 * Os números chegam como `CappedCount` (ver `lib/capped-count`): acima de
 * 1.000 o valor é PISO, não total. Regra desta faixa: nada é derivado por
 * subtração ou divisão de um valor com teto.
 *   - total no teto → "1.000+", sem percentual nem barra nos outros cartões;
 *   - "sem responsável" com total no teto e "com responsável" exato → é pelo
 *     menos `1.000 − com`, e diz "N+"; com os dois no teto → "—".
 */
export interface LeadsStatsV2Props {
  total: CappedCount;
  thisMonth: CappedCount;
  withOwner: CappedCount;
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
  value: React.ReactNode;
  icon: LucideIcon;
  tone: Tone;
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

const BAR: Partial<Record<Tone, string>> = {
  info: "bg-insights",
  gold: "bg-primary",
  good: "bg-success",
};

/** "Sem responsável": exato, piso ("N+") ou desconhecido — nunca subtração de piso. */
function unassignedOf(total: CappedCount, withOwner: CappedCount): { label: string; atLeast: number | null } {
  if (!total.capped) {
    const n = Math.max(0, total.value - withOwner.value);
    return { label: nf.format(n), atLeast: n };
  }
  if (withOwner.capped) return { label: "—", atLeast: null };
  const floor = Math.max(0, LEADS_COUNT_CAP - withOwner.value);
  return { label: `${nf.format(floor)}+`, atLeast: floor };
}

export function LeadsStatsV2({ total, thisMonth, withOwner, isLoading, filters }: LeadsStatsV2Props) {
  const reduce = useReducedMotion();
  // Percentual e barra só com total EXATO e não vazio.
  const totalExato = !total.capped && total.value > 0 ? total.value : 0;
  const semDono = unassignedOf(total, withOwner);
  const comDonoPct = totalExato ? Math.round((withOwner.value / totalExato) * 100) : 0;
  const unassigned = filters?.unassigned;

  const tiles: Tile[] = [
    {
      key: "total",
      label: "Total de leads",
      value: formatCappedCount(total),
      icon: Users,
      tone: "info",
      context: total.capped ? `${nf.format(total.value)} ou mais, com os filtros atuais` : "Na organização, com os filtros atuais",
    },
    {
      key: "mes",
      label: "Este mês",
      value: formatCappedCount(thisMonth),
      icon: UserPlus,
      tone: "gold",
      share: totalExato ? share(thisMonth.value, totalExato) : undefined,
      context: totalExato ? `${pf.format(thisMonth.value / totalExato)} do total entraram este mês` : "Entraram este mês",
      filter: filters?.thisMonth && { ...filters.thisMonth, hint: "Filtrar por criados este mês" },
    },
    {
      key: "dono",
      label: "Com responsável",
      // Percentual como no mockup; o absoluto vai na nota. Sem total exato,
      // o absoluto É o valor — percentual de um piso seria número inventado.
      value: totalExato ? (
        <>
          {comDonoPct}
          <ValueUnit>%</ValueUnit>
        </>
      ) : total.capped ? (
        formatCappedCount(withOwner)
      ) : (
        "—"
      ),
      icon: UserCheck,
      tone: "good",
      share: totalExato ? share(withOwner.value, totalExato) : undefined,
      context: totalExato
        ? `${nf.format(withOwner.value)} de ${nf.format(totalExato)}`
        : total.capped
          ? "Leads com dono no recorte"
          : "Nenhum lead no recorte",
    },
    {
      key: "sem-dono",
      label: "Leads sem responsável",
      value: semDono.label,
      icon: UserX,
      tone: semDono.atLeast === null ? "neutral" : semDono.atLeast > 0 ? "bad" : "good",
      context:
        semDono.atLeast === null
          ? "Recorte grande demais para contar"
          : semDono.atLeast > 0
            ? "Ninguém responde por eles"
            : "Todos têm dono",
    },
  ];

  return (
    <KpiRow cols={4}>
      {tiles.map((t, i) => {
        const clickable = !!t.filter;
        const active = !!t.filter?.active || (t.key === "sem-dono" && !!unassigned?.active);
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
            value={isLoading ? "·" : t.value}
            loading={isLoading}
            // Ativo: o ícone vira o "×" que desfaz, no chip de ouro.
            icon={active && clickable ? X : t.icon}
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
                  className={cn("h-full rounded-full", BAR[t.tone] ?? "bg-foreground/60")}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(isLoading ? 0 : t.share) * 100}%` }}
                  transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : 0.15 + i * 0.04 }}
                />
              </div>
            )}
            {/* O filtro "sem dono" que já existia, agora com porta no número
                que ele conta (o mockup tinha "Ligar distribuição", que no app
                é configuração por funil — não cabe aqui). */}
            {t.key === "sem-dono" && unassigned && (semDono.atLeast !== 0 || unassigned.active) && (
              <Button
                variant="ink"
                size="sm"
                className="h-[30px]"
                aria-pressed={unassigned.active}
                onClick={unassigned.toggle}
              >
                {unassigned.active ? "Ver todos" : "Ver sem dono"}
              </Button>
            )}
          </KpiTile>
        );
      })}
    </KpiRow>
  );
}
