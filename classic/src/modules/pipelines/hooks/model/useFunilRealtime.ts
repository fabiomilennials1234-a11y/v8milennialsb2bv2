import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useRealtimeOrgId } from "@/shared/realtime/realtime-org-context";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import {
  invalidarColunasDoFunil,
  planejarInvalidacaoRealtime,
  type EventoPipelineEntry,
} from "@/modules/pipelines/lib/funil-move-cache";

/**
 * Janela de agrupamento: o primeiro evento abre a janela e o lote dispara ao
 * fim dela, mesmo que eventos continuem chegando (janela fixa, não debounce —
 * uma automação em massa não adia a atualização para sempre).
 */
export const FUNIL_REALTIME_JANELA_MS = 1_000;

/**
 * Realtime cirúrgico do board `/funil/:slug`.
 *
 * Substitui `useRealtimeSubscription("pipeline_entries", ["pipeline-page", …])`,
 * que invalidava o PREFIXO — toda coluna de todo board montado, a cada evento
 * de qualquer card da org. Aqui cada evento vira, no máximo, as colunas que ele
 * toca neste funil + a contagem deste funil (`planejarInvalidacaoRealtime`).
 *
 * Filtro do canal: `organization_id`, não `pipeline_id`. O Realtime avalia o
 * filtro de UPDATE sobre a linha NOVA — um card que outro usuário (ou uma
 * auto-transição) tira deste funil chega com `pipeline_id` do destino e um
 * canal filtrado por este funil nunca o veria; o card ficaria órfão na tela.
 * O recorte por funil acontece no handler. O isolamento entre orgs continua
 * na RLS (`apply_rls`) — o filtro é só redução de tráfego, como antes.
 *
 * Sem org resolvida o canal NÃO abre (o hook genérico abria sem filtro).
 */
export function useFunilRealtime(pipelineId: string | undefined): void {
  const queryClient = useQueryClient();
  const organizationId = useRealtimeOrgId();
  const pipelineIdRef = useRef(pipelineId);
  pipelineIdRef.current = pipelineId;

  const pendentesRef = useRef<{ pipelineId: string; stages: Set<string> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const descarregar = useCallback(() => {
    timerRef.current = null;
    const lote = pendentesRef.current;
    pendentesRef.current = null;
    if (lote) invalidarColunasDoFunil(queryClient, lote.pipelineId, lote.stages);
  }, [queryClient]);

  const onEvent = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const atual = pipelineIdRef.current;
      if (!atual) return;
      const plano = planejarInvalidacaoRealtime(queryClient, atual, payload as unknown as EventoPipelineEntry);
      if (!plano) return;

      if (!pendentesRef.current || pendentesRef.current.pipelineId !== atual) {
        pendentesRef.current = { pipelineId: atual, stages: new Set() };
      }
      for (const s of plano.stages) pendentesRef.current.stages.add(s);
      if (!timerRef.current) timerRef.current = setTimeout(descarregar, FUNIL_REALTIME_JANELA_MS);
    },
    [queryClient, descarregar],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendentesRef.current = null;
    },
    [],
  );

  useRealtimeChannel({
    table: "pipeline_entries",
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onEvent,
    enabled: !!organizationId && !!pipelineId,
  });
}
