import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface OnboardingAnswers {
  perfil?: {
    sells?: "produto" | "servico" | "ambos";
    segment?: string;
    avg_ticket?: string;
    monthly_volume?: string;
  };
  estrutura?: {
    team_size?: string;
    has_sdr?: boolean;
    has_closer?: boolean;
    seller_type?: string;
  };
  processo?: {
    presentation_mode?: string;
    sales_cycle?: string;
    uses_proposal?: boolean;
    schedules_meeting?: boolean;
    wants_carteira?: boolean;
  };
}

export interface OrgOnboarding {
  id: string;
  organization_id: string;
  status: "pending" | "in_progress" | "completed" | "skipped";
  current_step: number;
  answers: OnboardingAnswers;
  applied_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useOnboarding() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["org-onboarding", organizationId],
    queryFn: async (): Promise<OrgOnboarding | null> => {
      if (!organizationId) return null;
      // `org_onboarding` foi substituída pela máquina de estados em `organizations`
      // (onboarding_state / onboarding_answers). Ler a tabela antiga dava PGRST205.
      const { data, error } = await supabase
        .from("organizations")
        .select("id, onboarding_state, onboarding_answers, onboarding_completed_at, created_at, updated_at")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as {
        id: string;
        onboarding_state: string | null;
        onboarding_answers: OnboardingAnswers | null;
        onboarding_completed_at: string | null;
        created_at: string;
        updated_at: string;
      };
      return {
        id: row.id,
        organization_id: row.id,
        status: row.onboarding_state === "completed" ? "completed" : "in_progress",
        current_step: 0,
        answers: row.onboarding_answers ?? {},
        applied_at: null,
        completed_at: row.onboarding_completed_at,
        completed_by: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Pick<OrgOnboarding, "status" | "current_step" | "answers" | "applied_at" | "completed_at" | "completed_by">>) => {
      if (!organizationId) throw new Error("No org");
      const { data, error } = await supabase
        .from("org_onboarding")
        .update(updates)
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-onboarding", organizationId] });
    },
  });

  const saveStepAnswers = async (stepKey: string, stepAnswers: Record<string, unknown>, nextStep: number) => {
    const currentAnswers = query.data?.answers ?? {};
    const merged = { ...currentAnswers, [stepKey]: stepAnswers };
    await updateMutation.mutateAsync({
      answers: merged as OnboardingAnswers,
      current_step: nextStep,
      status: "in_progress",
    });
  };

  const complete = async (userId: string) => {
    await updateMutation.mutateAsync({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: userId,
    });
  };

  const skip = async () => {
    await updateMutation.mutateAsync({ status: "skipped" });
  };

  const markApplied = async () => {
    await updateMutation.mutateAsync({ applied_at: new Date().toISOString() });
  };

  return {
    onboarding: query.data,
    isLoading: query.isLoading,
    needsOnboarding: query.data?.status === "pending" || query.data?.status === "in_progress",
    noRecord: !query.isLoading && query.data === null,
    saveStepAnswers,
    complete,
    skip,
    markApplied,
    update: updateMutation.mutateAsync,
    isSaving: updateMutation.isPending,
  };
}
