/**
 * Implementação — leitura e escrita do kanban de implantação.
 *
 * Tudo passa pelas RPCs da migration 20271105000100: a tabela não aceita
 * escrita direta, e o gate de cada etapa (IM-2/3/4) é cobrado no banco.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";
import type { ImplementacaoFacts, ImplementacaoGates, ImplementacaoStage } from "../lib/implementacao-kanban";

export interface MasterImplementation extends ImplementacaoFacts {
  id: string;
  organization_id: string;
  org_name: string;
  org_created_at: string;
  subscription_plan: string | null;
  owner_name: string | null;
  call_scheduled_at: string | null;
  call_participants: string | null;
  completed_at: string | null;
}

const KEY = "master-implementations";

export function useMasterImplementations() {
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<MasterImplementation[]> => {
      const { data, error } = await supabase.rpc("master_list_implementations");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        id: r.organization_id,
        stage: r.stage as ImplementacaoStage,
        gates: r.gates as unknown as ImplementacaoGates,
      }));
    },
    enabled: isMaster,
    staleTime: 30_000,
  });
}

export function useMasterStaff() {
  const { isMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-staff"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("master_list_staff");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isMaster,
    staleTime: 5 * 60_000,
  });
}

export function useAdvanceImplementation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orgId, to }: { orgId: string; to: ImplementacaoStage }) => {
      const { error } = await supabase.rpc("master_advance_implementation", { p_org_id: orgId, p_to_stage: to });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateImplementation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      orgId: string;
      ownerMasterUserId: string | null;
      callScheduledAt: string | null;
      callParticipants: string | null;
    }) => {
      const { error } = await supabase.rpc("master_update_implementation", {
        p_org_id: v.orgId,
        p_owner_master_user_id: v.ownerMasterUserId,
        p_call_scheduled_at: v.callScheduledAt,
        p_call_participants: v.callParticipants,
      });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}
