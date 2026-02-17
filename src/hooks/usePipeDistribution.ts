/**
 * usePipeDistribution — CRUD para regras de distribuição de leads em pipes.
 * Gerencia pipe_distribution_rules + pipe_distribution_members.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { toast } from "sonner";

export type DistributionMode = "round_robin" | "random" | "single" | null;

export interface PipeDistributionRule {
  id: string;
  organization_id: string;
  pipe_type: string;
  sdr_mode: DistributionMode;
  sdr_assigned_to: string | null;
  closer_mode: DistributionMode;
  closer_assigned_to: string | null;
}

export interface PipeDistributionMember {
  id: string;
  rule_id: string;
  team_member_id: string;
  role: "sdr" | "closer";
}

const QUERY_KEY = "pipe-distribution";

/**
 * Busca regra de distribuição + membros do pool para um pipe específico.
 */
export function usePipeDistributionRule(pipeType: string) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [QUERY_KEY, pipeType, organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data: rule, error } = await supabase
        .from("pipe_distribution_rules")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType)
        .maybeSingle();

      if (error) throw error;
      if (!rule) return null;

      const { data: members, error: membersError } = await supabase
        .from("pipe_distribution_members")
        .select("*")
        .eq("rule_id", rule.id)
        .order("created_at");

      if (membersError) throw membersError;

      return {
        rule: rule as PipeDistributionRule,
        members: (members ?? []) as PipeDistributionMember[],
      };
    },
    enabled: isReady && !!organizationId,
  });
}

/**
 * Salva regra de distribuição (upsert) + sincroniza membros do pool.
 */
export function useSavePipeDistribution() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      pipeType: string;
      sdrMode: DistributionMode;
      sdrAssignedTo: string | null;
      closerMode: DistributionMode;
      closerAssignedTo: string | null;
      sdrMemberIds: string[];
      closerMemberIds: string[];
    }) => {
      if (!organizationId) throw new Error("Sem organização");

      // Upsert da regra
      const { data: rule, error: ruleError } = await supabase
        .from("pipe_distribution_rules")
        .upsert(
          {
            organization_id: organizationId,
            pipe_type: payload.pipeType,
            sdr_mode: payload.sdrMode,
            sdr_assigned_to: payload.sdrAssignedTo,
            closer_mode: payload.closerMode,
            closer_assigned_to: payload.closerAssignedTo,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,pipe_type" }
        )
        .select("id")
        .single();

      if (ruleError) throw ruleError;

      // Sincronizar membros: deletar todos e reinserir
      const { error: deleteError } = await supabase
        .from("pipe_distribution_members")
        .delete()
        .eq("rule_id", rule.id);

      if (deleteError) throw deleteError;

      const membersToInsert = [
        ...payload.sdrMemberIds.map((id) => ({
          rule_id: rule.id,
          team_member_id: id,
          role: "sdr" as const,
        })),
        ...payload.closerMemberIds.map((id) => ({
          rule_id: rule.id,
          team_member_id: id,
          role: "closer" as const,
        })),
      ];

      if (membersToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("pipe_distribution_members")
          .insert(membersToInsert);

        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Distribuição salva!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao salvar distribuição");
    },
  });
}
