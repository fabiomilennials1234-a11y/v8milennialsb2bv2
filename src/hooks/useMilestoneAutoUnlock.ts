/**
 * useMilestoneAutoUnlock — Checks if outbound member achieved any milestones
 * and auto-unlocks the corresponding badges.
 *
 * Runs on dashboard load. Compares current month metrics vs badge criteria.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useBadges, useUserBadges, useUnlockBadge } from "./useBadges";
import { useOutboundMetrics } from "./useOutboundMetrics";
import { useOrganization } from "@/modules/identity";
export function useMilestoneAutoUnlock() {
  const { teamMemberId } = useOrganization();
  const { data: badges } = useBadges();
  const { data: userBadges } = useUserBadges(teamMemberId);
  const { data: metrics } = useOutboundMetrics();
  const unlockBadge = useUnlockBadge();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!badges || !userBadges || !metrics || !teamMemberId || checkedRef.current) return;
    checkedRef.current = true;

    const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));

    // Map criteria_type to current metric value
    const criteriaMap: Record<string, number> = {
      leads_recebidos: metrics.leadsRecebidos,
      leads_respondidos: metrics.taxaResposta > 0 ? Math.round((metrics.taxaResposta / 100) * metrics.leadsRecebidos) : 0,
      reunioes_agendadas: metrics.reunioesAgendadas,
      vendas_count: metrics.vendasFechadas,
      // faturamento_total requires separate query — skip for now
    };

    for (const badge of badges) {
      if (unlockedIds.has(badge.id)) continue;
      if (!badge.criteria_type || !badge.criteria_value) continue;

      const currentValue = criteriaMap[badge.criteria_type];
      if (currentValue === undefined) continue;

      if (currentValue >= badge.criteria_value) {
        unlockBadge.mutate(
          { badgeId: badge.id, teamMemberId },
          {
            onSuccess: () => {
              toast.success(`Badge desbloqueado: ${badge.name}!`, {
                description: `Parabéns! Você conquistou o marco "${badge.name}"`,
                duration: 8000,
              });
            },
          }
        );
      }
    }
  }, [badges, userBadges, metrics, teamMemberId]);
}
