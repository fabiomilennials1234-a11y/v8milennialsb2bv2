import { useEffect, useMemo, useRef, useState } from "react";
import { InkRow, InkSplit } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { usePortfolioClients, type PortfolioClientRow } from "@/modules/carteira/hooks/usePortfolioClients";
import { erpLabel } from "@/shared/format/erp-code";
import { CarteiraClientPreview } from "./CarteiraClientPreview";

/**
 * Radar de recompra — o herói "fila + foco" da Carteira (mockup V5).
 *
 * A fila é a mesma RPC da tabela (`get_portfolio_clients`) nos dois recortes
 * que já existiam como filtro — `expected` ("Esta semana") e `overdue`
 * ("Atrasados") — ordenada pela próxima compra esperada. O cartão de ouro está
 * SEMPRE aberto: abre no primeiro da fila e segue a seleção.
 *
 * A tabela de baixo também pode pôr um cliente em foco (`focusClient`) — o
 * cartão mostra quem foi escolhido mesmo que ele não esteja na fila.
 */

type RadarFilter = "expected" | "overdue";

const RADAR_SIZE = 7;

const compact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function initials(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

interface CarteiraRadarProps {
  /** Cliente posto em foco pela tabela; `null` = o primeiro da fila. */
  focusClient: PortfolioClientRow | null;
  onFocusClient: (client: PortfolioClientRow | null) => void;
  onViewDetail: (clientId: string) => void;
  onNewOrder: (clientId: string) => void;
  /** Quantos estão em cada recorte (de `get_portfolio_kpis`). */
  counts: { expected?: number; overdue?: number };
}

export function CarteiraRadar({ focusClient, onFocusClient, onViewDetail, onNewOrder, counts }: CarteiraRadarProps) {
  // Abre onde há ação: atrasados se houver, senão os previstos da semana.
  const [filter, setFilter] = useState<RadarFilter>((counts.overdue ?? 0) > 0 ? "overdue" : "expected");
  // Os KPIs chegam depois do primeiro render: até a pessoa escolher, o radar
  // segue a regra "abre onde há ação".
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current && (counts.overdue ?? 0) > 0) setFilter("overdue");
  }, [counts.overdue]);
  const { data, isLoading } = usePortfolioClients({
    filter,
    sortBy: "next_order_expected",
    sortDir: "asc",
    page: 1,
    pageSize: RADAR_SIZE,
  });
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;

  // Trocar de recorte devolve o foco ao primeiro da fila nova.
  useEffect(() => {
    onFocusClient(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const focused = focusClient ?? rows[0] ?? null;

  const segmented = (
    <div role="tablist" aria-label="Recorte do radar" className="inline-flex items-center gap-0.5 rounded-full bg-white/[.07] p-[3px]">
      {(
        [
          { value: "expected", label: "Esta semana", n: counts.expected },
          { value: "overdue", label: "Atrasados", n: counts.overdue },
        ] as const
      ).map((opt) => {
        const active = filter === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              picked.current = true;
              setFilter(opt.value);
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              active ? "bg-tinta-foreground text-tinta" : "text-tinta-muted hover:text-tinta-foreground",
            )}
          >
            {opt.label}
            {opt.n != null && opt.n > 0 && <span className="tabular-nums opacity-70">{opt.n}</span>}
          </button>
        );
      })}
    </div>
  );

  const list = isLoading ? (
    Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[.06]" />)
  ) : rows.length === 0 ? (
    <p className="px-3 py-8 text-center text-[13px] text-tinta-muted">
      {filter === "overdue" ? "Nenhum cliente com recompra atrasada." : "Nenhum pedido previsto para esta semana."}
    </p>
  ) : (
    rows.map((client) => {
      const next = daysUntil(client.next_order_expected);
      const selected = focused?.id === client.id;
      const estado =
        next == null
          ? null
          : next < 0
            ? { label: `Atrasado ${Math.abs(next)} d`, late: true }
            : next === 0
              ? { label: "Previsto hoje", late: false }
              : { label: `Previsto em ${next} d`, late: false };
      return (
        <InkRow key={client.id} selected={selected} onClick={() => onFocusClient(client)} aria-label={`Ver ${erpLabel(client)}`}>
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl text-[12px] font-extrabold",
              selected ? "bg-primary-foreground/10" : "bg-white/10 text-tinta-foreground",
            )}
          >
            {initials(erpLabel(client))}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-bold">{erpLabel(client)}</span>
            <span className={cn("block truncate text-[11px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
              {client.reorder_cycle_days ? `a cada ${client.reorder_cycle_days} d` : client.company ?? "—"}
            </span>
          </span>
          {estado && (
            <span
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                selected
                  ? "bg-primary-foreground text-primary"
                  : estado.late
                    ? "bg-destructive/20 text-destructive"
                    : "bg-white/10 text-tinta-foreground",
              )}
            >
              {estado.label}
            </span>
          )}
          {client.avg_ticket != null && (
            <span className="hidden shrink-0 text-[12px] font-extrabold tabular-nums sm:inline">
              {compact.format(client.avg_ticket)}
            </span>
          )}
        </InkRow>
      );
    })
  );

  return (
    <InkSplit
      title="Radar de recompra"
      count={isLoading ? undefined : `${total.toLocaleString("pt-BR")} ${filter === "overdue" ? "atrasados" : "previstos"}`}
      actions={segmented}
      list={list}
      detail={
        focused ? (
          <CarteiraClientPreview client={focused} onViewDetail={onViewDetail} onNewOrder={onNewOrder} />
        ) : isLoading ? (
          <div className="min-h-[340px] animate-pulse rounded-card bg-primary/40" />
        ) : (
          <div className="grid min-h-[200px] place-items-center rounded-card border border-dashed border-white/15 px-6 text-center text-[13px] text-tinta-muted">
            Nada pedindo ação neste recorte. Troque para {filter === "overdue" ? "Esta semana" : "Atrasados"} ou veja a carteira abaixo.
          </div>
        )
      }
    />
  );
}
