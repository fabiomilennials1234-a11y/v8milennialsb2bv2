import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * useMovimentacoesPeriodo — painel "Movimentações no período" (Performance).
 *
 * Conta MOVIMENTAÇÕES por data do EVENTO no caderno canônico (não por data de
 * criação do lead), via RPC purpose-built `get_movement_metrics`:
 *   · marcadas     → meeting_events meeting_booked (occurred_at)
 *   · comparecidas → meeting_events meeting_held (coalesce(meeting_date, occurred_at))
 *   · vendido      → sale_events sale, líquido de estorno (sold_at) — count + Σ receita
 *
 * Isolado do ranking/gamificação. orgId vem de useOrganization (multi-tenancy —
 * o frontend nunca inventa org_id; a RPC filtra + guard assert_org_access).
 * Intervalo próprio: [start, end] fechado, resolvido pelo PeriodRangeControl.
 */

interface MovementMetricsRow {
  marcadas: number;
  comparecidas: number;
  vendido_count: number;
  vendido_receita: number;
}

export interface MovimentacoesPeriodoResult {
  marcadas: number;
  comparecidas: number;
  vendidoCount: number;
  vendidoReceita: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const EMPTY_ROW: MovementMetricsRow = {
  marcadas: 0,
  comparecidas: 0,
  vendido_count: 0,
  vendido_receita: 0,
};

export function useMovimentacoesPeriodo(
  start: Date | null,
  end: Date | null,
  memberId: string | null = null,
): MovimentacoesPeriodoResult {
  const { organizationId } = useOrganization();
  const startIso = start ? start.toISOString() : null;
  const endIso = end ? end.toISOString() : null;

  const query = useQuery({
    // memberId no fim: undefined vira null pra chave estável.
    queryKey: ["movement-metrics", organizationId, startIso, endIso, memberId ?? null],
    queryFn: async (): Promise<MovementMetricsRow> => {
      const { data, error } = await supabase.rpc("get_movement_metrics" as never, {
        p_org_id: organizationId,
        p_start: startIso,
        p_end: endIso,
        p_member_id: memberId,
      } as never);

      if (error) {
        console.error("❌ [useMovimentacoesPeriodo] RPC error:", error.message, error.code);
        throw new Error(`get_movement_metrics failed: ${error.message}`);
      }

      // RETURNS TABLE → array de 1 linha (Supabase pode entregar array ou objeto).
      const row = (Array.isArray(data) ? data[0] : data) as MovementMetricsRow | null | undefined;
      return row ?? EMPTY_ROW;
    },
    // Núcleo: precisa de org. Sem intervalo válido (custom incompleto) não dispara.
    enabled: !!organizationId && !!startIso && !!endIso,
    staleTime: 60 * 1000,
  });

  const d = query.data;
  return {
    marcadas: d?.marcadas ?? 0,
    comparecidas: d?.comparecidas ?? 0,
    vendidoCount: d?.vendido_count ?? 0,
    // numeric do Postgres pode voltar como string — normaliza pra number.
    vendidoReceita: Number(d?.vendido_receita ?? 0),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => query.refetch(),
  };
}
