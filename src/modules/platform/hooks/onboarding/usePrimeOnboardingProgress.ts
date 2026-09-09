/**
 * usePrimeOnboardingProgress — fallback client-side para orgs existentes.
 *
 * Onda 3.2 — Sprint 3.2.3
 *
 * O backfill da migration cria a linha mas deixa todos os steps false
 * para orgs que já tinham dados antes. Este hook verifica counts reais
 * no primeiro mount e atualiza steps que já foram concluídos.
 *
 * Roda uma vez por sessão (sessionStorage guard).
 * Custo: 5 COUNT queries na primeira visita — aceitável.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { OnboardingProgress, OnboardingStepKey } from "./useOnboardingChecklist";

const SESSION_KEY = "onb_prime_done";

interface CountResult {
  step: OnboardingStepKey;
  count: number;
}

export function usePrimeOnboardingProgress() {
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const primed = useRef(false);

  useEffect(() => {
    if (!organizationId) return;
    if (primed.current) return;

    // Guard de sessão — só roda uma vez por sessão
    const sessionGuard = sessionStorage.getItem(SESSION_KEY);
    if (sessionGuard === organizationId) return;

    primed.current = true;

    async function prime() {
      // Lê o progresso atual do cache
      const cached = qc.getQueryData<OnboardingProgress | null>([
        "onboarding-checklist",
        organizationId,
      ]);

      // Só roda se há pelo menos um step false
      const hasIncomplete = cached && Object.entries(cached).some(
        ([key, val]) => key.startsWith("step_") && val === false,
      );

      if (!hasIncomplete) {
        sessionStorage.setItem(SESSION_KEY, organizationId!);
        return;
      }

      // Queries paralelas de COUNT para cada step ainda false
      const checks: Promise<CountResult | null>[] = [];

      if (cached && !cached.step_import_lead) {
        checks.push(
          supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId!)
            .then(({ count }) => ({
              step: "step_import_lead" as OnboardingStepKey,
              count: count ?? 0,
            }))
            .catch(() => null),
        );
      }

      if (cached && !cached.step_configure_copilot) {
        checks.push(
          supabase
            .from("copilot_agents")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId!)
            .then(({ count }) => ({
              step: "step_configure_copilot" as OnboardingStepKey,
              count: count ?? 0,
            }))
            .catch(() => null),
        );
      }

      if (cached && !cached.step_create_workflow) {
        checks.push(
          supabase
            .from("workflows")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId!)
            .then(({ count }) => ({
              step: "step_create_workflow" as OnboardingStepKey,
              count: count ?? 0,
            }))
            .catch(() => null),
        );
      }

      if (cached && !cached.step_add_member) {
        checks.push(
          supabase
            .from("team_members")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId!)
            .then(({ count }) => ({
              step: "step_add_member" as OnboardingStepKey,
              count: count ?? 0,
            }))
            .catch(() => null),
        );
      }

      if (cached && !cached.step_first_sale) {
        checks.push(
          supabase
            .from("negocio_projetado")
            .select("id", { count: "exact", head: true })
            .eq("funil_sistema", "propostas")
            .eq("organization_id", organizationId!)
            .eq("stage_key", "vendido")
            .then(({ count }) => ({
              step: "step_first_sale" as OnboardingStepKey,
              count: count ?? 0,
            }))
            .catch(() => null),
        );
      }

      const results = await Promise.all(checks);
      const toMark = results
        .filter((r): r is CountResult => r !== null && r.count > 0)
        .map((r) => r.step);

      if (toMark.length > 0) {
        // UPDATE server-side para persistir
        const patch = Object.fromEntries(toMark.map((s) => [s, true]));
        await supabase
          .from("org_onboarding_progress" as "organizations")
          .update(patch as unknown as Record<string, unknown>)
          .eq("organization_id", organizationId!);

        // Invalidar cache para refetch
        qc.invalidateQueries({ queryKey: ["onboarding-checklist", organizationId] });
      }

      sessionStorage.setItem(SESSION_KEY, organizationId!);
    }

    void prime();
  }, [organizationId, qc]);
}
