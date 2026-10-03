import { AlarmClock, CalendarClock, Filter, HeartPulse, Receipt, Repeat, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { formatBRL } from "@/lib/format";

/**
 * Resumo da carteira — os cinco números de sempre, do mesmo `get_portfolio_kpis`.
 *
 * V5 (mockup, 02/10): ordem Receita · Ticket · Health · Pedidos esperados ·
 * Recompra atrasada, e só na aba Clientes. O banner amarelo de recompra
 * atrasada saiu: o número dele (clientes + R$ em risco) mora no último cartão,
 * com a mesma ação ("Ver clientes" liga o filtro de atrasados).
 */
/** Cinco colunas só a partir de xl — em lg a área útil ainda espreme o valor em reais. */
const ROW_CLASS = "lg:grid-cols-3 xl:grid-cols-5";

export function CarteiraKPIs({ onViewOverdue }: { onViewOverdue?: () => void } = {}) {
  const { data, isLoading } = usePortfolioKPIs();

  if (isLoading) {
    return (
      <KpiRow cols={5} className={ROW_CLASS}>
        {["Receita recorrente", "Ticket médio", "Health score médio", "Pedidos esperados", "Recompra atrasada"].map(
          (label) => (
            <KpiTile key={label} label={label} value="·" loading />
          ),
        )}
      </KpiRow>
    );
  }

  if (!data || data.total_clients === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border bg-card/60 px-6 py-8 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <Users className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-bold text-foreground">Sua carteira ainda está vazia</p>
        <p className="mx-auto max-w-md text-[13px] text-muted-foreground">
          Cadastre clientes manualmente, importe uma planilha ou marque propostas como vendidas. Os KPIs aparecem automaticamente.
        </p>
      </div>
    );
  }

  const {
    total_clients: totalClients,
    total_recurring: totalRecurring,
    expected_this_week: expectedThisWeek,
    overdue_count: overdueCount,
    overdue_revenue: overdueRevenue,
    avg_health: avgHealth,
    avg_ticket: avgTicket,
  } = data;

  return (
    <KpiRow cols={5} className={ROW_CLASS}>
      <KpiTile
        label="Receita recorrente"
        value={formatBRL(totalRecurring)}
        icon={Repeat}
        tone="gold"
        note="clientes em dia com a recompra"
      />

      <KpiTile
        label="Ticket médio"
        value={formatBRL(avgTicket)}
        icon={Receipt}
        tone="info"
        note={`${totalClients.toLocaleString("pt-BR")} clientes ativos`}
      />

      <KpiTile
        label="Health score médio"
        value={
          <>
            {avgHealth}
            <ValueUnit>/100</ValueUnit>
          </>
        }
        icon={HeartPulse}
        tone={avgHealth >= 70 ? "good" : avgHealth >= 50 ? "neutral" : "bad"}
        note="média da carteira"
      />

      <KpiTile
        label="Pedidos esperados"
        value={expectedThisWeek.toLocaleString("pt-BR")}
        icon={CalendarClock}
        tone="neutral"
        note="próximos 7 dias"
      />

      <KpiTile
        label="Recompra atrasada"
        value={
          <span className={overdueCount > 0 ? "text-destructive" : undefined}>
            {overdueCount.toLocaleString("pt-BR")}
          </span>
        }
        icon={AlarmClock}
        tone={overdueCount > 0 ? "bad" : "good"}
        note={overdueCount > 0 ? `${formatBRL(overdueRevenue)} em risco` : "tudo em dia"}
      >
        {overdueCount > 0 && onViewOverdue && (
          <Button variant="ink" size="sm" className="h-[30px]" onClick={onViewOverdue}>
            <Filter />
            Ver clientes
          </Button>
        )}
      </KpiTile>
    </KpiRow>
  );
}
