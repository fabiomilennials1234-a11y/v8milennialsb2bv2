/**
 * useOnboardingChecklist — hooks para checklist progressivo de onboarding.
 *
 * Onda 3.2 — Sprint 3.2.3
 *
 * Tabela: org_onboarding_progress (migration 20260422150000)
 * Namespace separado de useOnboarding (quiz one-shot).
 *
 * Nota: types.ts não inclui org_onboarding_progress ainda (gerado antes da migration).
 * Usar cast `as unknown as OnboardingProgress` até regenerar com supabase gen types.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

// ─── Tipo local (espelha a migration) ─────────────────────────────────────────

export interface OnboardingProgress {
  organization_id: string;
  step_connect_whatsapp: boolean;
  step_import_lead: boolean;
  step_configure_copilot: boolean;
  step_create_workflow: boolean;
  step_add_member: boolean;
  step_first_sale: boolean;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OnboardingStepKey =
  | "step_connect_whatsapp"
  | "step_import_lead"
  | "step_configure_copilot"
  | "step_create_workflow"
  | "step_add_member"
  | "step_first_sale";

// ─── Query ────────────────────────────────────────────────────────────────────

export function useOnboardingChecklist() {
  const { organizationId } = useOrganization();

  return useQuery<OnboardingProgress | null>({
    queryKey: ["onboarding-checklist", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from("org_onboarding_progress" as "organizations") // cast: tabela nova não está em types.ts ainda
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as OnboardingProgress | null;
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Marca um step como completo manualmente (steps sem trigger server-side).
 * Steps com trigger (connect_whatsapp, import_lead, etc) são marcados automaticamente.
 * Útil para steps que o cliente realiza fora do sistema.
 */
export function useCompleteOnboardingStep() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (step: OnboardingStepKey) => {
      if (!organizationId) throw new Error("organizationId ausente");

      const { error } = await supabase
        .from("org_onboarding_progress" as "organizations")
        .update({ [step]: true } as unknown as Record<string, unknown>)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding-checklist", organizationId] });
    },
  });
}

/**
 * Dismiss do checklist — seta dismissed_at para agora.
 * Organização não vê mais o checklist após dismiss.
 */
export function useDismissOnboarding() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organizationId ausente");

      const { error } = await supabase
        .from("org_onboarding_progress" as "organizations")
        .update({ dismissed_at: new Date().toISOString() } as unknown as Record<string, unknown>)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding-checklist", organizationId] });
    },
  });
}
