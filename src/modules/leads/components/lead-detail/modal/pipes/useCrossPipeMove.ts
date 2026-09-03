import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";

/**
 * useCrossPipeMove — unified stage-move hook for both system and custom
 * pipes. Replaces the popover logic that previously lived in
 * `MoveStageButton`. Returns a `move` callback plus a `pendingStageKey`
 * marker for optimistic-loading UI (StageSegment overlay/pulse).
 *
 * Contract per pipe family (SCRUM-637 — a view de compat saiu do caminho):
 *  - System pipes: write `{ stage_key, stage_changed_at }` DIRETO em
 *    `pipeline_entries` (fonte única desde a SCRUM-621 — a MESMA linha que as
 *    views `pipe_*` escreviam, então os gatilhos de métrica/venda disparam
 *    idêntico; mesmo caminho do `useMoverCardNoFunil` da página unificada),
 *    keyed by `pipeId` (= pipeline_entries.id). Morreu o mapa `PIPE_TABLE`:
 *    funil de sistema com slug novo movia nada em silêncio.
 *  - Custom pipes: write `{ stage_id: <uuid> }` into
 *    `custom_pipe_entries`, keyed by `entryId` — o INSTEAD OF da view carrega
 *    a lógica viva do board custom (auto-transition, gatilhos de workflow).
 *
 * Invalidates the queries the CrossPipePanel + activity column rely on, o board
 * de funil que hospeda o modal (`pipeline-page` / `pipeline-stage-counts`, ou o
 * par custom) e a camada de negócio (`leads-deals` / `leads-sales-metrics`) que
 * a lista de Leads e o `DealDetailDialog` leem — ver os blocos no `move`.
 */

export type CrossPipeMoveTarget =
  | {
      kind: "system";
      pipeId: string;
      stageKey: string;
      stageLabel: string;
    }
  | {
      kind: "custom";
      entryId: string;
      stageId: string;
      stageLabel: string;
    };

export interface UseCrossPipeMoveResult {
  /** Stage key/id currently being persisted (or null when idle). */
  pendingStageKey: string | null;
  /** True while any move is in flight. */
  isMoving: boolean;
  /** Stage key/id that just succeeded — drives the flash animation. */
  recentlyMovedStageKey: string | null;
  move: (target: CrossPipeMoveTarget) => Promise<void>;
}

export function useCrossPipeMove(leadId: string): UseCrossPipeMoveResult {
  const qc = useQueryClient();
  const logAction = useLogLeadAction();
  const [pendingStageKey, setPendingStageKey] = useState<string | null>(null);
  const [recentlyMovedStageKey, setRecentlyMovedStageKey] = useState<string | null>(null);

  const move = useCallback(
    async (target: CrossPipeMoveTarget) => {
      const targetKey = target.kind === "system" ? target.stageKey : target.stageId;
      setPendingStageKey(targetKey);
      try {
        if (target.kind === "system") {
          const { error } = await supabase
            .from("pipeline_entries")
            .update({ stage_key: target.stageKey, stage_changed_at: new Date().toISOString() })
            .eq("id", target.pipeId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("custom_pipe_entries")
            .update({
              stage_id: target.stageId,
              stage_changed_at: new Date().toISOString(),
            })
            .eq("id", target.entryId);
          if (error) throw error;
        }

        logAction({
          leadId,
          action: "stage_changed",
          description: `Movido para "${target.stageLabel}"`,
        });

        qc.invalidateQueries({ queryKey: ["lead_all_pipelines", leadId] });
        qc.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
        qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });

        /**
         * Board que HOSPEDA este modal.
         *
         * O `DealDetailDialog` só é montado nas quatro páginas de funil
         * (`PipeWhatsapp`, `PipeConfirmacao`, `PipePropostas`, `CustomPipeline`) —
         * nunca em /leads. O board fica vivo atrás do overlay e é a primeira coisa
         * que o usuário vê ao fechar o modal.
         *
         * `[target.pipeTable]` NÃO é a chave do board: casa apenas
         * `["pipe_propostas"|"pipe_confirmacao", "perf", orgId]` do painel de
         * performance (`useCloserPerformance.ts:53,74`) — e nada em `pipe_whatsapp`.
         * O board dos funis system é o `usePaginatedPipeline`:
         *   `["pipeline-page", slug, stageKey, orgId, filtersKey]`  → cards
         *   `["pipeline-stage-counts", slug, orgId, filtersKey]`    → badge da coluna
         * O Realtime de `pipeline_entries` (usePaginatedPipeline.ts:228) cobre só a
         * primeira, com 2s de debounce. O contador de coluna não tem assinatura
         * nenhuma e tem `staleTime: 30_000` — sem invalidar aqui, o número fica
         * errado até a janela perder e recuperar o foco. Mesma dupla que o drag do
         * kanban já invalida em `usePipeWhatsapp.ts:230-231`.
         *
         * O slug é o sufixo da view (`pipe_whatsapp` → `whatsapp`), que é
         * exatamente o `PipelineType` passado ao `usePaginatedPipeline` nas três
         * páginas system. Match por prefixo cobre toda combinação de stage/filtro.
         *
         * No custom, `["custom_pipe_entries"]` casa o board
         * (`useCustomPipelines.ts:251`), mas o badge da coluna vive em
         * `["custom_pipe_stage_counts", pipelineId, search]`
         * (`useCustomPipelines.ts:345`) e teria o mesmo furo — daí o par aqui também.
         */
        if (target.kind === "system") {
          // Sem `pipeTable` o alvo não sabe mais o slug — invalida por
          // PREFIXO (match parcial do TanStack v5): cobre as chaves por slug
          // do board legado E as por pipeline_id da página unificada. As três
          // chaves de view seguem invalidadas pelo painel de performance
          // (`useCloserPerformance` — `["pipe_propostas","perf",…]`).
          qc.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
          qc.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
          qc.invalidateQueries({ queryKey: ["pipe_propostas"] });
          qc.invalidateQueries({ queryKey: ["pipeline-page"] });
          qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
        } else {
          qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
          qc.invalidateQueries({ queryKey: ["custom_pipe_stage_counts"] });
        }

        /**
         * Camada "negócio" da lista de Leads e do drawer de negócio.
         *
         * Sem estas duas, mover a etapa deixava a MESMA tela mentindo: o
         * `DealDetailDialog` monta `useLeadsDeals` e este hook lado a lado, então
         * o trilho de etapas andava (vem de `lead_all_pipelines`) enquanto o
         * subtítulo, a cor de ganho e o `daysInStage` continuavam na etapa velha —
         * até dar F5. `useLeadsDeals` lê `pipeline_entries` (stage_key,
         * stage_changed_at) e cruza com `pipeline_stages`/`custom_pipeline_stages`
         * pra resolver o `stage_role` que vira o `outcome` do negócio;
         * `useLeadsSalesMetrics` lê `sale_events`, que ganha linha nova quando a
         * etapa de destino tem `stage_role = 'won'`. Ambas mudam neste UPDATE;
         * nenhuma era invalidada em lugar nenhum do repo.
         *
         * Prefixo de propósito: as queryKeys são `[chave, organizationId, ids]` e o
         * `ids` é a página corrente de leads — não dá pra reconstruir aqui, e o
         * match parcial do TanStack v5 já cobre todas as variantes montadas.
         *
         * `leads-carteira-metrics` fica de fora conscientemente: carteira vem de
         * `upsell_clients`/`upsell_orders` (ERP), e nenhuma mutação de card escreve
         * lá — invalidar seria refetch garantido-inútil a cada movimentação de etapa.
         */
        qc.invalidateQueries({ queryKey: ["leads-deals"] });
        qc.invalidateQueries({ queryKey: ["leads-sales-metrics"] });

        // Flash success on the now-current stage.
        setRecentlyMovedStageKey(targetKey);
        // Cool down so the animation runs every move.
        window.setTimeout(() => {
          setRecentlyMovedStageKey((cur) => (cur === targetKey ? null : cur));
        }, 360);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao mover";
        toast.error(msg);
      } finally {
        setPendingStageKey(null);
      }
    },
    [leadId, logAction, qc],
  );

  return useMemo(
    () => ({ pendingStageKey, isMoving: pendingStageKey !== null, recentlyMovedStageKey, move }),
    [pendingStageKey, recentlyMovedStageKey, move],
  );
}
