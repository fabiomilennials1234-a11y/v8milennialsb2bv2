import { useMemo } from "react";
import { useLeadsCarteiraMetrics } from "@/modules/leads/hooks/useLeadsCarteiraMetrics";
import { useLeadsSalesMetrics } from "@/modules/leads/hooks/useLeadsSalesMetrics";
import { mergeDataMetrics } from "@/modules/leads/lib/data-metrics";
import { PropertyGroup } from "./PropertyGroup";
import { cn } from "@/lib/utils";

/**
 * O cluster "Dados" — quanto este cliente já comprou.
 *
 * Vivia como coluna na lista de Leads e veio para cá por ADR-0024 decisão 1.
 * Medido em produção em 2026-08-04: de 35.165 leads vivos, **1.018** tinham
 * algo aqui. A coluna estava vazia **97,1%** do tempo e era a mais larga da
 * página, com 290px.
 *
 * A regra de qual fonte ganha (venda no funil × carteira de ERP) mora em
 * `lib/data-metrics.ts`, compartilhada com a lista — que ainda a usa para o selo
 * de `segment`. Duas cópias divergiriam no primeiro ajuste.
 *
 * **Some quando não há o que mostrar.** Um bloco "Compras" com quatro trações
 * seria pior do que a coluna que ele substitui: na lista o vazio era uma célula
 * em branco entre outras; aqui seria uma seção inteira afirmando que existe
 * história de compra onde não existe. Em 97% dos leads este componente não
 * renderiza nada.
 */
export function LeadPurchaseStats({ leadId }: { leadId: string }) {
  const ids = useMemo(() => [leadId], [leadId]);
  const { data: carteira } = useLeadsCarteiraMetrics(ids);
  const { data: vendas } = useLeadsSalesMetrics(ids);

  const m = useMemo(() => mergeDataMetrics(carteira, vendas)[leadId], [carteira, vendas, leadId]);

  // Sem compra nenhuma não há seção. `orderCount` é o sinal certo: um lead pode
  // ter `lifetimeValue` 0 com compra registrada (venda sem valor lançado), e
  // esse caso merece aparecer.
  if (!m || (m.orderCount ?? 0) === 0) return null;

  const cycleDays = m.reorderCycleDays;
  const sinceLast = m.daysSinceLastOrder;

  return (
    <PropertyGroup label="Compras">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 py-1">
        <Stat label="Total" value={formatBRL(m.lifetimeValue ?? 0)} strong />
        <Stat label="Compras" value={String(m.orderCount)} strong />
        {/* Com uma compra só ainda não existe intervalo a medir: dizer "0d"
            afirmaria recompra imediata, que é falso. `!== null` e não
            truthiness — duas compras no mesmo dia dão ciclo 0, que é legítimo. */}
        <Stat
          label="Ciclo de compra"
          value={cycleDays !== null ? `${cycleDays}d` : "calculando"}
          muted={cycleDays === null}
        />
        {/* "0d" em quem nunca comprou leria como "comprou hoje". */}
        <Stat
          label="Última compra"
          value={sinceLast === null ? "—" : `${sinceLast}d`}
          muted={sinceLast === null}
          danger={sinceLast !== null && sinceLast > 60}
        />
      </div>
    </PropertyGroup>
  );
}

function Stat({
  label,
  value,
  strong,
  muted,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col gap-px">
      <span className="text-[10.5px] leading-tight text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular-nums tracking-[-0.01em]",
          strong ? "text-sm font-semibold" : "text-[13px]",
          muted && "text-muted-foreground",
          danger && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}
