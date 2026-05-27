import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useOrganization } from "@/modules/identity";
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
        .from("pipeline_entries")
        .select(`
          id, stage_key, updated_at,
          lead:leads!pipeline_entries_lead_id_fkey(
            name, company,
            responsible:team_members!leads_responsible_id_fkey(name),
            sdr:team_members!leads_sdr_id_fkey(name),
            pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(name),
            sale_responsible:team_members!leads_sale_responsible_id_fkey(name)
          ),
          pipeline:pipelines!inner(slug)
        `)
        .eq("organization_id", organizationId)
        .eq("pipeline.slug", "confirmacao")
        .eq("pipeline.type", "system")
        .eq("stage_key", "compareceu")
        .order("updated_at", { ascending: false })
        .limit(5);

      meetings?.forEach((meeting: any) => {
        // Crédito de comparecimento é do SDR:
        // COALESCE(pre_sale_responsible, sdr). NÃO usar responsible — em
        // muitas orgs ele guarda o closer e atribuiria o evento ao time errado.
        const sdrName = meeting.lead?.pre_sale_responsible?.name || meeting.lead?.sdr?.name;
        activities.push({
          id: `meeting-${meeting.id}`,
          type: "meeting",
          title: "Reunião realizada",
          description: `${meeting.lead?.name}${sdrName ? ` com ${sdrName}` : ""}`,
          timestamp: meeting.updated_at,
          relativeTime: formatDistanceToNow(new Date(meeting.updated_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "calendar",
          color: "success",
          personName: sdrName || meeting.lead?.name,
        });
      });

      const { data: sales } = await supabase
        .from("pipeline_entries")
        .select(`
          id, stage_key, metadata, closed_at,
          lead:leads!pipeline_entries_lead_id_fkey(
            name, company,
            responsible:team_members!leads_responsible_id_fkey(name),
            closer:team_members!leads_closer_id_fkey(name),
            pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(name),
            sale_responsible:team_members!leads_sale_responsible_id_fkey(name)
          ),
          pipeline:pipelines!inner(slug)
        `)
        .eq("organization_id", organizationId)
        .eq("pipeline.slug", "propostas")
        .eq("pipeline.type", "system")
        .eq("stage_key", "vendido")
        .order("closed_at", { ascending: false })
        .limit(5);

      sales?.forEach((sale: any) => {
        const meta = (sale.metadata ?? {}) as Record<string, unknown>;
        const value = Number(meta.sale_value) || 0;
        activities.push({
          id: `sale-${sale.id}`,
          type: "sale",
          title: "Venda fechada! 🎉",
          description: `${sale.lead?.name} - R$ ${value.toLocaleString("pt-BR")}${(sale.lead?.responsible?.name || sale.lead?.closer?.name) ? ` por ${sale.lead?.responsible?.name || sale.lead?.closer?.name}` : ""}`,
          timestamp: sale.closed_at,
          relativeTime: formatDistanceToNow(new Date(sale.closed_at), {
            addSuffix: true,
            locale: ptBR,
          }),
          icon: "dollar",
          color: "success",
          value,
          personName: sale.lead?.sale_responsible?.name || sale.lead?.responsible?.name || sale.lead?.closer?.name,
        });
      });

      const { data: lost } = await supabase
        .from("pipeline_entries")
        .select(`
          id, updated_at,
          lead:leads!pipeline_entries_lead_id_fkey(name, company),
          pipeline:pipelines!inner(slug)
        `)
        .eq("organization_id", organizationId)
        .eq("pipeline.slug", "propostas")
        .eq("pipeline.type", "system")
        .eq("stage_key", "perdido")
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
    refetchInterval: 60000, // 60s — atividade recente não precisa de polling agressivo
    refetchIntervalInBackground: false, // Parar polling quando a aba está em background
  });
}
