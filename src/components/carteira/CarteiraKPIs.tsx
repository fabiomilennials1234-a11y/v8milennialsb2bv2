import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  valueClassName?: string;
}

function KPICard({ label, value, sub, valueClassName }: KPICardProps) {
  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
      <div className="text-xs font-medium text-[#71717a] uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-[28px] font-bold mt-1 tracking-tight leading-tight ${valueClassName ?? "text-white"}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs mt-1 text-[#a1a1aa]">{sub}</div>}
    </div>
  );
}

export function CarteiraKPIs() {
  const { data, isLoading } = usePortfolioHealth();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-[#18181b] border border-[#27272a] rounded-xl p-4">
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-zinc-800 rounded w-2/3" />
              <div className="h-7 bg-zinc-800 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Receita Recorrente" value="—" />
        <KPICard label="Pedidos Esperados" value="—" />
        <KPICard label="Recompra Atrasada" value="—" />
        <KPICard label="Ticket Médio" value="—" />
        <KPICard label="Health Score Médio" value="—" />
      </div>
    );
  }

  const { totalClients, totalRecurring, expectedThisWeek, overdueCount, avgHealth } = data;
  const avgTicket = totalClients > 0 ? totalRecurring / totalClients : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KPICard
        label="Receita Recorrente"
        value={formatBRL(totalRecurring)}
        sub="ticket médio mensal"
        valueClassName="text-[#eab308]"
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
        valueClassName={overdueCount > 0 ? "text-[#ef4444]" : undefined}
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
