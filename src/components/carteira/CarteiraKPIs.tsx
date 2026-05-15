import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
import { formatBRL } from "@/lib/format";

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  valueClassName?: string;
}

function KPICard({ label, value, sub, valueClassName }: KPICardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-[28px] font-bold mt-1 tracking-tight leading-tight ${valueClassName ?? "text-foreground"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[13px] mt-1 text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function CarteiraKPIs() {
  const { data, isLoading } = usePortfolioKPIs();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4">
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-muted rounded w-2/3" />
              <div className="h-7 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.total_clients === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Sua carteira ainda está vazia
        </p>
        <p className="text-[13px] text-muted-foreground/60 mt-1 max-w-md mx-auto">
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
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KPICard
        label="Receita Recorrente"
        value={formatBRL(totalRecurring)}
        sub="ticket médio mensal"
        valueClassName={totalRecurring > 0 ? "text-primary" : undefined}
      />

      <KPICard
        label="Pedidos Esperados"
        value={expectedThisWeek}
        sub="próximos 7 dias"
      />

      <KPICard
        label="Recompra Atrasada"
        value={overdueCount}
        sub={overdueCount > 0 ? "clientes em atraso" : "tudo em dia"}
        valueClassName={overdueCount > 0 ? "text-destructive" : undefined}
      />

      <KPICard
        label="Ticket Médio"
        value={formatBRL(avgTicket)}
        sub={`${totalClients} clientes ativos`}
      />

      <KPICard
        label="Health Score Médio"
        value={avgHealth}
        sub="/100"
      />
    </div>
  );
}
