import { AlarmClock, CalendarClock, HeartPulse, Receipt, Repeat, Users } from "lucide-react";
import { KpiTile, ValueUnit } from "@/components/ui/bento";
import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { formatBRL } from "@/lib/format";

/**
 * Resumo da carteira — os cinco números de sempre, do mesmo `get_portfolio_kpis`.
 *
 * V5 (2026-10): vira fileira de `KpiTile`. Nenhum número novo: a cor deixa de
 * pintar o valor inteiro (ouro em letra reprova contraste no claro) e passa a
 * morar no chip do ícone; só o atraso continua vermelho no número, porque é o
 * único que pede ação.
 */
const GRID = "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5";

export function CarteiraKPIs() {
  const { data, isLoading } = usePortfolioKPIs();

  if (isLoading) {
    return (
      <div className={GRID}>
        {["Receita recorrente", "Pedidos esperados", "Recompra atrasada", "Ticket médio", "Health score médio"].map(
          (label) => (
            <KpiTile key={label} label={label} value="·" loading />
          ),
        )}
      </div>
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
    avg_health: avgHealth,
    avg_ticket: avgTicket,
  } = data;

  return (
    <div className={GRID}>
      <KpiTile
        label="Receita recorrente"
        value={formatBRL(totalRecurring)}
        icon={Repeat}
        tone="gold"
        note="clientes em dia com a recompra"
      />

      <KpiTile
        label="Pedidos esperados"
        value={expectedThisWeek.toLocaleString("pt-BR")}
        icon={CalendarClock}
        tone="info"
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
        note={overdueCount > 0 ? "clientes em atraso" : "tudo em dia"}
      />

      <KpiTile
        label="Ticket médio"
        value={formatBRL(avgTicket)}
        icon={Receipt}
        tone="neutral"
        note={`${totalClients} clientes ativos`}
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
    </div>
  );
}
