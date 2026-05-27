import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { isVirtualTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { toast } from "sonner";
import type { ChecklistWithCounts } from "@/modules/engagement/hooks/useChecklists";

export function useChecklistTemplates() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("checklists", ["checklist_templates"]);

  return useQuery({
    queryKey: ["checklist_templates", organizationId],
    queryFn: async (): Promise<ChecklistWithCounts[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("checklists")
        .select(`*, checklist_items(id, is_completed)`)
        .eq("organization_id", organizationId)
        .is("lead_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((c: any) => {
        const items = c.checklist_items ?? [];
        return {
          ...c,
          checklist_items: undefined,
          total_items: items.length,
          completed_items: items.filter((i: any) => i.is_completed).length,
          lead: null,
        };
      });
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useApplyChecklistTemplate() {
  const queryClient = useQueryClient();
  const { organizationId, teamMemberId } = useOrganization();

  return useMutation({
    mutationFn: async ({ templateId, leadId }: { templateId: string; leadId: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data: template, error: tErr } = await supabase
        .from("checklists")
        .select("title, description")
        .eq("id", templateId)
        .single();

      if (tErr) throw tErr;

      const { data: templateItems, error: iErr } = await supabase
        .from("checklist_items")
        .select("title, position")
        .eq("checklist_id", templateId)
        .order("position", { ascending: true });

      if (iErr) throw iErr;

      const { data: newChecklist, error: cErr } = await supabase
        .from("checklists")
        .insert({
          organization_id: organizationId,
          created_by: teamMemberId && !isVirtualTeamMember(teamMemberId) ? teamMemberId : null,
          title: template.title,
          description: template.description,
          lead_id: leadId,
        })
        .select()
        .single();

      if (cErr) throw cErr;

      if (templateItems && templateItems.length > 0) {
        const itemsToInsert = templateItems.map((item) => ({
          checklist_id: newChecklist.id,
          title: item.title,
          position: item.position,
        }));

        const { error: insertErr } = await supabase
          .from("checklist_items")
          .insert(itemsToInsert);

        if (insertErr) throw insertErr;
      }

      return newChecklist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      toast.success("Template aplicado ao lead!");
    },
    onError: (error) => {
      toast.error("Erro ao aplicar template", { description: error.message });
    },
  });
}
