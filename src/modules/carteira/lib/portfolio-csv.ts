import { supabase } from "@/integrations/supabase/client";
import type { PortfolioClientsResponse } from "@/modules/carteira/hooks/usePortfolioClients";

/** CSV da carteira com o recorte atual — o botão mora no cabeçalho da página. */
export async function exportPortfolioCsv(
  orgId: string,
  filter: string,
  search: string,
) {
  const { data, error } = await supabase.rpc("get_portfolio_clients", {
    p_org_id: orgId,
    p_filter: filter,
    p_search: search,
    p_sort_by: "name",
    p_sort_dir: "asc",
    p_page: 1,
    p_page_size: 10000,
  });
  if (error) throw error;

  // A RPC devolve `Json`; o formato é o mesmo que `usePortfolioClients` lê.
  const response = data as unknown as PortfolioClientsResponse;
  const headers = [
    "Nome",
    "Empresa",
    "Health Score",
    "Status",
    "Segmento",
    "Ticket Médio",
    "Dias Sem Pedido",
    "Próximo Pedido",
    "LTV",
    "Tendência",
  ];

  const csvRows = response.rows.map((r) =>
    [
      `"${(r.name ?? "").replace(/"/g, '""')}"`,
      `"${(r.company ?? "").replace(/"/g, '""')}"`,
      r.health_score ?? "",
      r.health_status ?? "",
      r.segment ?? "",
      r.avg_ticket ?? "",
      r.days_since_last_order ?? "",
      r.next_order_expected ? r.next_order_expected.slice(0, 10) : "",
      r.lifetime_value ?? "",
      r.trend ?? "",
    ].join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carteira-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
