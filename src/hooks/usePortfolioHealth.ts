import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export function usePortfolioHealth() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["portfolio-health", organizationId],
    queryFn: async () => {
      const { data: clients } = await supabase
        .from("upsell_clients")
        .select(
          "id, name, company, phone, email, lead_id, health_score, health_status, segment, avg_ticket, lifetime_value, days_since_last_order, reorder_cycle_days, next_order_expected, order_count, is_active, potencial, closer_id, first_sale_at, last_order_at, trend",
        )
        .eq("organization_id", organizationId!)
        .eq("is_active", true);

      if (!clients?.length) return null;

      const totalRecurring = clients.reduce((s, c) => s + Number(c.avg_ticket || 0), 0);
      const overdueClients = clients.filter(
        (c) =>
          c.days_since_last_order &&
          c.reorder_cycle_days &&
          c.days_since_last_order > c.reorder_cycle_days * 1.15,
      );
      const overdueRevenue = overdueClients.reduce((s, c) => s + Number(c.avg_ticket || 0), 0);
      const avgHealth = Math.round(
        clients.reduce((s, c) => s + (c.health_score || 0), 0) / clients.length,
      );
      const avgTicket = clients.length > 0 ? Math.round(totalRecurring / clients.length) : 0;

      const now = Date.now();
      const weekFromNow = now + 7 * 86400000;
      const expectedThisWeek = clients.filter(
        (c) =>
          c.next_order_expected &&
          new Date(c.next_order_expected).getTime() <= weekFromNow &&
          new Date(c.next_order_expected).getTime() >= now,
      ).length;

      return {
        totalClients: clients.length,
        totalRecurring,
        overdueCount: overdueClients.length,
        overdueRevenue,
        avgTicket,
        avgHealth,
        expectedThisWeek,
        clients,
      };
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
