import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { usePipelineStages, type PipelineStage } from "./usePipelineStages";
import { useUpsellClients } from "./useUpsellClients";
import { useUpsellOrders } from "./useUpsellOrders";
import { useUpsellGestaoRules } from "./useUpsellGestaoRules";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hook que calcula e aplica auto-movimentação de clientes upsell
 * baseado nos dias desde a última venda e nas regras das etapas.
 *
 * Fluxo:
 * 1. Calcula dias desde última venda por cliente
 * 2. Match regras da Base (auto_move_min/max_days) → atualiza tipo_cliente_tempo
 * 3. Se Base mudou, busca regras de sincronização (upsell_gestao_rules)
 *    para (base_stage_key, gestao_stage_atual) → atualiza gestao_stage
 * 4. Respeita gestao_manual_override (não move Gestão se override ativo)
 *
 * Roda uma vez quando os dados estão prontos.
 * O trigger no banco cuida da movimentação imediata após uma venda.
 */
export function useAutoMoveUpsellClients() {
  const { organizationId } = useOrganization();
  const { data: baseStages } = usePipelineStages("upsell_base");
  const { data: clients } = useUpsellClients();
  const { data: orders } = useUpsellOrders();
  const { data: gestaoRules } = useUpsellGestaoRules();
  const queryClient = useQueryClient();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!organizationId || !baseStages || !clients || !orders || !gestaoRules || hasRun.current) return;

    const baseRules = (baseStages as PipelineStage[]).filter(
      (s) => s.auto_move_min_days != null && s.auto_move_max_days != null
    );

    if (baseRules.length === 0) return;

    hasRun.current = true;

    // Calcular última venda por cliente
    const lastSaleByClient: Record<string, string> = {};
    for (const order of orders) {
      const clientId = order.client_id;
      const soldAt = order.sold_at;
      if (!clientId || !soldAt) continue;
      if (!lastSaleByClient[clientId] || soldAt > lastSaleByClient[clientId]) {
        lastSaleByClient[clientId] = soldAt;
      }
    }

    const now = new Date();
    const updates: { id: string; tipo_cliente_tempo?: string; gestao_stage?: string }[] = [];

    for (const client of clients) {
      if (!client.is_active) continue;

      const lastSale = lastSaleByClient[client.id] || client.first_sale_at;
      if (!lastSale) continue;

      const daysSinceLastSale = Math.floor(
        (now.getTime() - new Date(lastSale).getTime()) / (1000 * 60 * 60 * 24)
      );

      const changes: { tipo_cliente_tempo?: string; gestao_stage?: string } = {};

      // Match upsell_base rules
      const matchBase = baseRules.find(
        (s) => daysSinceLastSale >= s.auto_move_min_days! && daysSinceLastSale <= s.auto_move_max_days!
      );

      if (matchBase && matchBase.stage_key !== client.tipo_cliente_tempo) {
        changes.tipo_cliente_tempo = matchBase.stage_key;

        // If base changed AND no manual override, look for sync rule
        if (!client.gestao_manual_override) {
          const syncRule = gestaoRules.find(
            (r) =>
              r.base_stage_key === matchBase.stage_key &&
              r.gestao_from_stage === client.gestao_stage &&
              r.is_active
          );

          if (syncRule && syncRule.gestao_to_stage !== client.gestao_stage) {
            changes.gestao_stage = syncRule.gestao_to_stage;
          }
        }
      }

      if (changes.tipo_cliente_tempo || changes.gestao_stage) {
        updates.push({ id: client.id, ...changes });
      }
    }

    if (updates.length === 0) return;

    // Aplicar updates em batch (silenciosamente)
    const applyUpdates = async () => {
      for (const update of updates) {
        const { id, ...fields } = update;
        await supabase
          .from("upsell_clients")
          .update(fields)
          .eq("id", id)
          .eq("organization_id", organizationId);
      }
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
    };

    applyUpdates();
  }, [organizationId, baseStages, clients, orders, gestaoRules, queryClient]);
}
