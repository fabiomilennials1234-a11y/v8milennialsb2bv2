import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useOrganization } from "./useOrganization";

export interface Activity {
  id: string;
  type: "lead" | "meeting" | "sale" | "proposal" | "lost";
  title: string;
  description: string;
  timestamp: string;
  relativeTime: string;
  icon: "user" | "calendar" | "dollar" | "file" | "x";
  color: "primary" | "success" | "warning" | "destructive" | "muted";
  value?: number;
  personName?: string;
}

export function useRecentActivity(limit: number = 10) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["recent-activity", limit, organizationId],
    queryFn: async (): Promise<Activity[]> => {
      if (!organizationId) return [];
      const activities: Activity[] = [];

      const { data: leads } = await supabase
        .from("leads")
        .select("id, name, company, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(5);

      leads?.forEach((lead) => {
        activities.push({
          id: `lead-${lead.id}`,
          type: "lead",
          title: "Novo lead cadastrado",
          description: `${lead.name}${lead.company ? ` - ${lead.company}` : ""}`,
          timestamp: lead.created_at,
          relativeTime: formatDistanceToNow(new Date(lead.created_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "user",
          color: "primary",
          personName: lead.name,
        });
      });

      const { data: meetings } = await supabase
        .from("pipe_confirmacao")
        .select(`
          id, status, updated_at,
          lead:leads(name, company),
          sdr:team_members!pipe_confirmacao_sdr_id_fkey(name)
        `)
        .eq("organization_id", organizationId)
        .eq("status", "compareceu")
        .order("updated_at", { ascending: false })
        .limit(5);

      meetings?.forEach((meeting: any) => {
        activities.push({
          id: `meeting-${meeting.id}`,
          type: "meeting",
          title: "Reunião realizada",
          description: `${meeting.lead?.name}${meeting.sdr?.name ? ` com ${meeting.sdr.name}` : ""}`,
          timestamp: meeting.updated_at,
          relativeTime: formatDistanceToNow(new Date(meeting.updated_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "calendar",
          color: "success",
          personName: meeting.lead?.name,
        });
      });

      const { data: sales } = await supabase
        .from("pipe_propostas")
        .select(`
          id, sale_value, product_type, closed_at,
          lead:leads(name, company),
          closer:team_members!pipe_propostas_closer_id_fkey(name)
        `)
        .eq("organization_id", organizationId)
        .eq("status", "vendido")
        .order("closed_at", { ascending: false })
        .limit(5);

      sales?.forEach((sale: any) => {
        const value = Number(sale.sale_value) || 0;
        activities.push({
          id: `sale-${sale.id}`,
          type: "sale",
          title: "Venda fechada! 🎉",
          description: `${sale.lead?.name} - R$ ${value.toLocaleString("pt-BR")}${sale.closer?.name ? ` por ${sale.closer.name}` : ""}`,
          timestamp: sale.closed_at,
          relativeTime: formatDistanceToNow(new Date(sale.closed_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "dollar",
          color: "success",
          value,
          personName: sale.closer?.name,
        });
      });

      const { data: lost } = await supabase
        .from("pipe_propostas")
        .select(`
          id, updated_at,
          lead:leads(name, company)
        `)
        .eq("organization_id", organizationId)
        .eq("status", "perdido")
        .order("updated_at", { ascending: false })
        .limit(3);

      lost?.forEach((deal: any) => {
        activities.push({
          id: `lost-${deal.id}`,
          type: "lost",
          title: "Negócio perdido",
          description: deal.lead?.name || "Lead sem nome",
          timestamp: deal.updated_at,
          relativeTime: formatDistanceToNow(new Date(deal.updated_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "x",
          color: "destructive",
          personName: deal.lead?.name,
        });
      });

      return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    },
    enabled: isReady && !!organizationId,
    refetchInterval: 30000,
  });
}
