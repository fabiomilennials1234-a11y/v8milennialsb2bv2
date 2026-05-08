import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { triggerFollowUpAutomation } from "./useAutoFollowUp";
import { triggerStageChangedWorkflows } from "@/lib/workflowTrigger";
import { useRealtimeSubscription, type RealtimeHandlers } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";
import { useCanPerformActionAsync } from "@/lib/permissions";

/** Surgical realtime handlers — avoid full refetch for single-item changes */
const realtimeHandlers: RealtimeHandlers = {
  onUpdate: (updated, oldData) =>
    oldData.map((item) =>
      item.id === updated.id ? { ...item, ...updated } : item
    ),
  onDelete: (deleted, oldData) =>
    oldData.filter((item) => item.id !== deleted.id),
};

export type PipeConfirmacao = Tables<"pipe_confirmacao">;
export type PipeConfirmacaoInsert = TablesInsert<"pipe_confirmacao">;
export type PipeConfirmacaoUpdate = TablesUpdate<"pipe_confirmacao">;

// Dynamic — accepts any stage_key from pipeline_stages (custom stages supported)
export type PipeConfirmacaoStatus = string;

// Visual Kanban columns - pre_confirmada and confirmada_no_dia are NOT shown as columns
// They are visual states (colors) on the cards instead
export const statusColumns: { id: string; title: string; color: string }[] = [
  { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
  { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
  { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
  { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
  { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
  { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
  { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
  { id: "compareceu", title: "Compareceu ✓", color: "#22c55e" },
  { id: "perdido", title: "Perdido ✗", color: "#ef4444" },
];

export function usePipeConfirmacao() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("pipe_confirmacao", ["pipe_confirmacao"], realtimeHandlers);

  return useQuery({
    queryKey: ["pipe_confirmacao", organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .select(`
          *,
          lead:leads(
            id, name, company, email, phone, rating, origin, segment, faturamento, urgency, ai_disabled, sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
            responsible:team_members!leads_responsible_id_fkey(id, name),
            sdr:team_members!leads_sdr_id_fkey(id, name),
            closer:team_members!leads_closer_id_fkey(id, name),
            pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
            sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
            lead_tags(tag:tags(id, name, color))
          ),
          responsible:team_members!pipe_confirmacao_responsible_id_fkey(id, name),
          sdr:team_members!pipe_confirmacao_sdr_id_fkey(id, name),
          closer:team_members!pipe_confirmacao_closer_id_fkey(id, name),
          pre_sale_responsible:team_members!pipe_confirmacao_pre_sale_responsible_id_fkey(id, name),
          sale_responsible:team_members!pipe_confirmacao_sale_responsible_id_fkey(id, name)
        `)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isReady && !!organizationId,
    staleTime: 10 * 60 * 1000, // 10 min — realtime subscription garante freshness
  });
}

export function useCreatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (item: PipeConfirmacaoInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create pipe_confirmacao: No organization context");
      }
      const securedItem = {
        ...item,
        organization_id: organizationId,
      };
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .insert(securedItem)
        .select()
        .single();

      if (error) throw error;

      // Trigger automation for the initial status
      await triggerFollowUpAutomation({
        leadId: data.lead_id,
        assignedTo: data.responsible_id || data.sdr_id || data.closer_id,
        pipeType: "confirmacao",
        stage: data.status,
        sourcePipeId: data.id,
        organizationId: data.organization_id,
      });

      // stage_changed workflows are fired by the PG trigger on pipe_confirmacao
      // (via pg_net → process-workflow-executions). No need to fire from frontend.

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}

export function useUpdatePipeConfirmacao() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: movePermission } = useCanPerformActionAsync("move_pipe_record");

  return useMutation({
    mutationFn: async ({ id, leadId, assignedTo, ...updates }: PipeConfirmacaoUpdate & { id: string; leadId?: string; assignedTo?: string | null }) => {
      if (!organizationId) {
        throw new Error("Cannot update pipe_confirmacao: No organization context");
      }

      // Detecta mudança real de status: SELECT do row atual e compara com payload.
      // Decisão server-side proxy do Security (opção B) — caller não pode bypassar
      // omitindo `status` e move_pipe_record só é checado quando status muda de fato.
      let isStatusChange = false;
      if (updates.status !== undefined) {
        const { data: current, error: selErr } = await supabase
          .from("pipe_confirmacao")
          .select("status")
          .eq("id", id)
          .single();
        if (selErr || !current) {
          // Não vazar diferença "não existe" vs "sem permissão"
          throw new Error("Registro não encontrado");
        }
        isStatusChange = current.status !== updates.status;

        if (isStatusChange) {
          // Fail-closed em loading: enquanto movePermission ainda não chegou
          // (`undefined`), bloqueia. Só libera com `allowed === true`.
          if (!movePermission || !movePermission.allowed) {
            throw new Error("Sem permissão para mover registros no pipe");
          }
        } else {
          // status no payload mas igual ao atual — remove pra evitar UPDATE inútil
          // + log de auditoria fantasma (trigger de stage_change dispara em UPDATE OF status).
          delete updates.status;
        }
      }

      const payload = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      ) as PipeConfirmacaoUpdate;
      const { data, error } = await supabase
        .from("pipe_confirmacao")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      // Sync meeting_date → leads.compromisso_date (espelho).
      // Só dispara quando meeting_date foi explicitamente passado (inclusive null = deletando reunião).
      if (leadId && updates.meeting_date !== undefined) {
        await supabase
          .from("leads")
          .update({ compromisso_date: updates.meeting_date })
          .eq("id", leadId)
          .eq("organization_id", organizationId);
      }

      // Sync responsible_id back to leads table
      if (leadId && updates.responsible_id !== undefined) {
        await supabase
          .from("leads")
          .update({ responsible_id: updates.responsible_id || null })
          .eq("id", leadId)
          .eq("organization_id", organizationId);
      }

      // Trigger automation só quando status mudou de fato
      if (isStatusChange && updates.status && leadId) {
        await triggerFollowUpAutomation({
          leadId: leadId,
          assignedTo: assignedTo || data.responsible_id || data.sdr_id || data.closer_id,
          pipeType: "confirmacao",
          stage: updates.status,
          sourcePipeId: data.id,
          organizationId: data.organization_id,
        });

        // Trigger visual workflow automations
        triggerStageChangedWorkflows({
          organizationId: data.organization_id,
          leadId,
          pipeType: "confirmacao",
          toStage: updates.status,
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"], refetchType: "active" });
      queryClient.invalidateQueries({ queryKey: ["leads"], refetchType: "active" });
    },
  });
}

export function useDeletePipeConfirmacao() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipe_confirmacao")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
