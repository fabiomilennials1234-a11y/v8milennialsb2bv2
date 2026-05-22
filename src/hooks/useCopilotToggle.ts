/**
 * useCopilotToggle — hook ÚNICO pra ler+togglar copilot AI por lead/phone.
 *
 * Substitui (Onda 2 Toggle Unify, 2026-04-26):
 *   - useLeadAiStatus(leadId)
 *   - usePhoneAiStatus(phone)
 *   - useToggleLeadAI()
 *   - useToggleConversationAI()
 *   - useQuery+useMutation inline em ChatShellWithContext, LeadDetailSheet,
 *     KanbanCard, WhatsAppChat
 *
 * Garantias:
 *   - Source of truth: phone_ai_preferences via RPC SECURITY DEFINER
 *     (get_phone_ai_status com p_organization_id explícito — H1 multi-org fix).
 *   - Mutação roteia: master → master_set_copilot_disabled, membro → toggle_lead_ai
 *     ou toggle_phone_ai (se sem leadId).
 *   - Query key unificada `["copilot-toggle", orgId, normalizedPhone]` —
 *     toggle em uma tela invalida em todas as outras automaticamente.
 *   - Optimistic update + rollback em erro.
 *   - Realtime broadcasta via subscription em phone_ai_preferences (Onda 2 U3).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useIdentity } from "./useIdentity";
import { normalizePhone } from "@/lib/normalizePhone";

export interface CopilotToggleStatus {
  ai_disabled: boolean;
  source: "preference" | "lead" | "default" | "invalid_phone" | "no_input";
  organization_id: string | null;
  normalized_phone: string | null;
  lead_id: string | null;
}

/** Query key canônica. Use SEMPRE essa pra invalidar/ler estado de toggle. */
export function copilotToggleQueryKey(
  organizationId: string | null | undefined,
  phone: string | null | undefined,
): ["copilot-toggle", string | null, string | null] {
  return ["copilot-toggle", organizationId ?? null, normalizePhone(phone) ?? null];
}

/**
 * Lê estado atual do copilot pra um lead/phone.
 * Aceita ambos: `phone` é a fonte canônica; `leadId` é usado pra mutações
 * (toggle_lead_ai com sync de duplicatas).
 */
export function useCopilotToggleStatus(params: {
  phone?: string | null;
  leadId?: string | null;
}) {
  const { phone, leadId } = params;
  const { organizationId } = useOrganization();
  const { isMaster } = useIdentity();

  const normalized = normalizePhone(phone ?? null);
  const queryKey = copilotToggleQueryKey(organizationId, phone);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<CopilotToggleStatus> => {
      if (!normalized) {
        return {
          ai_disabled: false,
          source: "no_input",
          organization_id: organizationId ?? null,
          normalized_phone: null,
          lead_id: leadId ?? null,
        };
      }

      // Master sem organization context: usa get_phone_ai_status com a org
      // do lead (resolvida via leadId). Fallback: get_lead_ai_status quando
      // só tem leadId.
      // Caminho normal: get_phone_ai_status com p_organization_id explícito.
      const { data, error } = await supabase.rpc("get_phone_ai_status", {
        p_phone: normalized,
        p_organization_id: organizationId ?? undefined,
      });

      if (error) {
        console.warn("[useCopilotToggleStatus] RPC error:", error.message);
        // Fallback se a RPC falhar: tenta get_lead_ai_status pelo leadId
        if (leadId) {
          const { data: leadData } = await supabase.rpc("get_lead_ai_status", {
            p_lead_id: leadId,
          });
          const parsed = typeof leadData === "string" ? JSON.parse(leadData) : leadData;
          return {
            ai_disabled: Boolean(parsed?.ai_disabled),
            source: "lead",
            organization_id: organizationId ?? null,
            normalized_phone: normalized,
            lead_id: leadId,
          };
        }
        return {
          ai_disabled: false,
          source: "default",
          organization_id: organizationId ?? null,
          normalized_phone: normalized,
          lead_id: leadId ?? null,
        };
      }

      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      return {
        ai_disabled: Boolean(parsed?.ai_disabled),
        source: (parsed?.source as CopilotToggleStatus["source"]) ?? "default",
        organization_id: parsed?.organization_id ?? organizationId ?? null,
        normalized_phone: parsed?.normalized_phone ?? normalized,
        lead_id: parsed?.lead_id ?? leadId ?? null,
      };
    },
    enabled: Boolean(normalized) || Boolean(leadId),
    staleTime: 30_000,
  });
}

/**
 * Mutação canônica: liga/desliga copilot pra um lead/phone.
 * Optimistic update na query key unificada + invalidação cross-tela.
 */
export function useCopilotToggleMutation() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isMaster } = useIdentity();

  return useMutation({
    mutationFn: async (input: {
      disabled: boolean;
      leadId?: string | null;
      phone?: string | null;
    }) => {
      const { disabled, leadId, phone } = input;

      if (!leadId && !phone) {
        throw new Error("useCopilotToggleMutation: precisa de leadId OU phone");
      }

      // Master cross-org: master_set_copilot_disabled (precisa leadId).
      if (isMaster && leadId) {
        const { data, error } = await supabase.rpc("master_set_copilot_disabled", {
          p_lead_id: leadId,
          p_disabled: disabled,
        });
        if (error) throw new Error(error.message || "Erro ao alterar IA (master)");
        return { ai_disabled: disabled, lead_id: leadId, via: "master" as const, data };
      }

      // Membro com leadId: toggle_lead_ai (sync duplicatas + UPSERT prefs).
      if (leadId) {
        const { data, error } = await supabase.rpc("toggle_lead_ai", {
          p_lead_id: leadId,
          p_disabled: disabled,
        });
        if (error) throw new Error(error.message || "Erro ao alterar IA");
        return { ai_disabled: disabled, lead_id: leadId, via: "lead" as const, data };
      }

      // Sem lead, só phone: toggle_phone_ai (canonical com org explícita).
      if (!organizationId) {
        throw new Error("useCopilotToggleMutation: organização não disponível");
      }
      const normalized = normalizePhone(phone ?? null);
      if (!normalized) throw new Error("Telefone inválido");

      const { data, error } = await supabase.rpc("toggle_phone_ai", {
        p_phone: normalized,
        p_disabled: disabled,
        p_organization_id: organizationId,
      });
      if (error) throw new Error(error.message || "Erro ao alterar IA (phone)");
      return { ai_disabled: disabled, lead_id: null, via: "phone" as const, data };
    },

    // Optimistic update na query key unificada (todas telas com mesmo phone)
    onMutate: async ({ disabled, phone, leadId }) => {
      const key = copilotToggleQueryKey(organizationId, phone);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CopilotToggleStatus>(key);

      queryClient.setQueryData<CopilotToggleStatus>(key, (old) => ({
        ai_disabled: disabled,
        source: old?.source ?? "preference",
        organization_id: old?.organization_id ?? organizationId ?? null,
        normalized_phone: old?.normalized_phone ?? normalizePhone(phone ?? null),
        lead_id: old?.lead_id ?? leadId ?? null,
      }));

      // Compat: também atualiza query keys legadas (até U4 migrar tudo)
      if (leadId) {
        queryClient.setQueryData(["lead_ai_status", leadId], { ai_disabled: disabled });
        queryClient.setQueryData(["lead-ai-status", leadId], { ai_disabled: disabled });
      }

      return { previous, key };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous && context.key) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _err, vars) => {
      // Invalida query unificada — todas telas com mesmo phone refazem fetch
      const key = copilotToggleQueryKey(organizationId, vars.phone);
      queryClient.invalidateQueries({ queryKey: key });

      // Compat: invalida keys legadas
      if (vars.leadId) {
        queryClient.invalidateQueries({ queryKey: ["lead_ai_status", vars.leadId] });
        queryClient.invalidateQueries({ queryKey: ["lead-ai-status", vars.leadId] });
        queryClient.invalidateQueries({ queryKey: ["lead-detail", vars.leadId] });
      }
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
    },
  });
}

/**
 * Hook combinado: estado + mutação. Use este na UI.
 *
 * @example
 * const { aiDisabled, toggle, isPending } = useCopilotToggle({ phone, leadId });
 * <Switch checked={!aiDisabled} onCheckedChange={(checked) => toggle(!checked)} />
 */
export function useCopilotToggle(params: {
  phone?: string | null;
  leadId?: string | null;
}) {
  const status = useCopilotToggleStatus(params);
  const mutation = useCopilotToggleMutation();

  const toggle = (disabled: boolean) => {
    mutation.mutate({
      disabled,
      leadId: params.leadId ?? null,
      phone: params.phone ?? null,
    });
  };

  return {
    aiDisabled: status.data?.ai_disabled ?? false,
    source: status.data?.source ?? "default",
    organizationId: status.data?.organization_id ?? null,
    normalizedPhone: status.data?.normalized_phone ?? null,
    leadId: status.data?.lead_id ?? params.leadId ?? null,
    isLoading: status.isLoading,
    isPending: mutation.isPending,
    error: mutation.error,
    toggle,
    refetch: status.refetch,
  };
}
