import { useMemo } from "react";
import { useUpsellClients } from "./useUpsellClients";
import { useUpsellOrders } from "./useUpsellOrders";
import { useUpsellCampanhas } from "./useUpsellCampanhas";

/**
 * Metricas calculadas a partir de upsell_orders e upsell_clients.
 * Vendas totais e vendas do mes.
 */
export function useUpsellMetrics() {
  const { data: clients = [] } = useUpsellClients();
  const { data: orders = [] } = useUpsellOrders();
  const { data: campanhas = [] } = useUpsellCampanhas();

  return useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // --- Vendas ---
    const vendasTotal = orders.reduce((sum, o) => sum + Number(o.sale_value || 0), 0);
    const ordersDoMes = orders.filter((o) => {
      const soldAt = new Date(o.sold_at);
      return soldAt >= monthStart && soldAt <= monthEnd;
    });
    const vendasMes = ordersDoMes.reduce((sum, o) => sum + Number(o.sale_value || 0), 0);

    // Vendas por origem
    const vendasUpsellMes = ordersDoMes
      .filter((o) => o.origin === "upsell")
      .reduce((sum, o) => sum + Number(o.sale_value || 0), 0);
    const vendasNewBusinessMes = ordersDoMes
      .filter((o) => o.origin === "new_business")
      .reduce((sum, o) => sum + Number(o.sale_value || 0), 0);

    // --- Clientes ---
    const totalClientes = clients.length;
    const clientesAtivos = clients.filter((c) => c.is_active).length;
    const clientesInativos = clients.filter((c) => !c.is_active).length;

    // --- Campanhas ---
    const statusFinais = ["vendido", "perdido", "futuro"];
    const campanhasAtivas = campanhas.filter((c) => !statusFinais.includes(c.status)).length;
    const campanhasVendidas = campanhas.filter((c) => c.status === "vendido").length;
    const campanhasTotal = campanhas.length;
    const taxaConversao = campanhasTotal > 0
      ? Math.round((campanhasVendidas / campanhasTotal) * 100)
      : 0;

    // Vendas por coluna (para stats do Kanban base)
    const vendasPorColuna: Record<string, number> = {};
    for (const client of clients) {
      if (!client.is_active) continue;
      const clientOrders = orders.filter((o) => o.client_id === client.id);
      const total = clientOrders.reduce((sum, o) => sum + Number(o.sale_value || 0), 0);
      const col = client.tipo_cliente_tempo;
      vendasPorColuna[col] = (vendasPorColuna[col] || 0) + total;
    }

    // --- Gestão (lifecycle) ---
    const gestaoCounts: Record<string, number> = {};
    for (const client of clients) {
      const stage = (client as any).gestao_stage || "primeira_compra";
      gestaoCounts[stage] = (gestaoCounts[stage] || 0) + 1;
    }

    return {
      vendasTotal,
      vendasMes,
      vendasUpsellMes,
      vendasNewBusinessMes,
      totalClientes,
      clientesAtivos,
      clientesInativos,
      campanhasAtivas,
      campanhasVendidas,
      campanhasTotal,
      taxaConversao,
      vendasPorColuna,
      gestaoCampeoes: gestaoCounts["campeoes"] || 0,
      gestaoFieis: gestaoCounts["fieis"] || 0,
      gestaoEmRisco: gestaoCounts["em_risco"] || 0,
      gestaoInativos: gestaoCounts["inativos"] || 0,
    };
  }, [clients, orders, campanhas]);
}
