import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { PipelineType, StageFamily, PipelineStage, PipelineStageInsert, DefaultStage } from "@/contracts/pipe";
import { FALLBACK_STAGES } from "@/contracts/pipe";
import {
  proximaPosicaoDeEtapa,
  mensagemDeConflitoDeEtapa,
} from "@/modules/pipelines/lib/proxima-posicao-de-etapa";

// `PipelineType` + `PipelineStage(Insert)` + `getPipelineTypeName` +
// `stagesToColumns` têm definição canônica em contracts (puros, sem
// side-effect) — quebra import direto leads→pipelines. Re-exportados aqui
// mantendo a API pública inalterada.
export type { PipelineType, StageFamily, PipelineStage, PipelineStageInsert, DefaultStage };
// FALLBACK_STAGES: constante PURA em `@/contracts/pipe` (quebra ciclo
// communication/leads -> pipelines via barrel). Re-exportada aqui p/ API estável.
// SCRUM-641: o antigo `DEFAULT_STAGES` (Record por trio) morreu — funil é
// funil, e o fallback de exibição é uma trilha só.
export { FALLBACK_STAGES };

/**
 * Os tipos de funil de sistema que a org tem, lidos do registro.
 *
 * Leitura direta (não o hook `usePipelineDisplayConfig`) de propósito: isto roda
 * DENTRO do `queryFn`, onde não se pode chamar hook.
 *
 * ⚠️ Em erro devolve conjunto VAZIO, não "todos". Um erro transitório de rede
 * não pode ressuscitar um funil que a org excluiu.
 */
async function lerTiposHabilitados(organizationId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("pipeline_display_config")
    .select("pipe_type")
    .eq("organization_id", organizationId);

  if (error) {
    console.warn("Não foi possível ler pipeline_display_config:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.pipe_type as string));
}

/**
 * Constrói o fallback em memória de etapas padrão, satisfazendo `PipelineStage`.
 *
 * Antes, o fallback era um objeto inline com 10 das colunas. Como o outro ramo
 * do `queryFn` devolve `PipelineStage`, o TS inferia união
 * `PipelineStage | {shape reduzido}` e todo consumidor que lesse campo ausente
 * do shape reduzido quebrava — eram 7 dos erros de tipo que travavam o CI
 * (`target_pipeline_id`/`target_stage_id` em PipeWhatsapp, PipeConfirmacao,
 * PipePropostas, mais o cast de PipeOpsProvider).
 *
 * O shape segue o **contrato** `PipelineStage` (`@/contracts/pipe`), que é mais
 * estrito que a tabela: `organization_id`/`created_at`/`updated_at` são
 * não-nulos e as colunas de SLA nem existem nele. Copiar o shape da TABELA aqui
 * foi o erro das duas tentativas anteriores.
 */
function buildFallbackStages(
  pipelineType: PipelineType,
  organizationId: string | null,
): PipelineStage[] {
  // Anotar o retorno do callback (e não só o da função) faz o tipo fluir por
  // contexto para dentro do literal — sem isso `stage_role: "open"` alarga para
  // `string` e não satisfaz o enum `StageRole`.
  const syntheticTimestamp = new Date(0).toISOString();
  return FALLBACK_STAGES.map((stage, index): PipelineStage => ({
    id: stage.id,
    // Etapa sintética, nunca persistida: sem org dona, e timestamp de epoch
    // sinaliza "não veio do banco" sem fingir uma data plausível.
    organization_id: organizationId ?? "",
    pipeline_type: pipelineType,
    stage_key: stage.id,
    name: stage.title,
    color: stage.color,
    position: index,
    is_active: true,
    is_final_positive: stage.is_final_positive ?? false,
    is_final_negative: stage.is_final_negative ?? false,
    // NOT NULL, default 'open' no banco. O seed server-side
    // (`create_default_pipeline_stages`) também não escreve este campo — a
    // linha real destas mesmas etapas nasce 'open' e o trigger do #990 aplica
    // o papel de sistema. won/lost é papel governado (ADR-0017 §1), nunca
    // derivado de is_final_*.
    stage_role: "open",
    suggested_stage_role: null,
    stage_role_suggested_at: null,
    stage_role_suggestion_source: null,
    stage_role_reviewed_at: null,
    stage_role_reviewed_by: null,
    auto_move_min_days: null,
    auto_move_max_days: null,
    target_pipe_type: stage.target_pipe_type ?? null,
    target_stage_key: stage.target_stage_key ?? null,
    target_pipeline_id: null,
    target_stage_id: null,
    checklist_template_id: null,
    created_at: syntheticTimestamp,
    updated_at: syntheticTimestamp,
  }));
}

/**
 * Hook para buscar etapas de um pipeline específico
 */
export function usePipelineStages(pipelineType: PipelineType) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  useRealtimeSubscription("pipeline_stages", ["pipeline_stages", pipelineType]);

  return useQuery({
    queryKey: ["pipeline_stages", pipelineType, organizationId],
    queryFn: async (): Promise<PipelineStage[]> => {
      if (!organizationId) {
        // Retornar etapas padrão se não houver organização
        return buildFallbackStages(pipelineType, null);
      }

      const fallbackStages = buildFallbackStages(pipelineType, organizationId);

      try {
        // ── Portão do registro ────────────────────────────────────────────
        // Só funil que a org registra em `pipeline_display_config` existe.
        // Todo `PipelineType` é registrável desde SCRUM-618 (as famílias
        // `upsell_*` saíram do union — a Carteira lê etapas pelo caminho
        // dedicado dela, `useCarteiraStages`).
        const tiposHabilitados = await lerTiposHabilitados(organizationId);

        // 🚨 Torneira nº 4. A org não tem este funil (nunca teve, ou
        // excluiu): devolver lista VAZIA, nunca `fallbackStages`. Enquanto
        // este ramo caía no fallback, o funil excluído continuava
        // renderizando com as etapas padrão em memória — o banco ficava
        // limpo e a tela mentia.
        if (!tiposHabilitados.has(pipelineType)) return [];

        const { data, error } = await supabase
          .from("pipeline_stages")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("pipeline_type", pipelineType)
          .eq("is_active", true)
          .order("position", { ascending: true });

        // Erro de leitura: fallback RENDER-ONLY (nunca é escrito no banco) —
        // segura a tela num blip de rede sem inventar estado.
        if (error) {
          console.warn("Pipeline stages table not available, using defaults:", error.message);
          return fallbackStages;
        }

        // SCRUM-618: lista vazia é estado LEGÍTIMO. O seed é 100% server-side
        // (`enable_system_pipeline` → `create_default_pipeline_stages`) e o
        // front não semeia nem finge etapa: funil habilitado sem etapa ativa
        // renderiza vazio. Medido em prod (2026-09-01): zero orgs neste
        // estado — o ramo só aparece se a org desativar todas as etapas.
        return (data ?? []) as PipelineStage[];
      } catch (err) {
        // Fallback em caso de qualquer erro
        console.warn("Error fetching pipeline stages, using defaults:", err);
        return fallbackStages;
      }
    },
    enabled: true,
  });
}

/**
 * Hook para buscar todas as etapas de todos os pipelines (para admin)
 */
export function useAllPipelineStages() {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["all_pipeline_stages", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("organization_id", organizationId)
        .order("pipeline_type")
        .order("position", { ascending: true });

      if (error) throw error;
      return data as PipelineStage[];
    },
    enabled: !!organizationId,
  });
}

// `stagesToColumns` movido para contracts (puro). Re-exportado para manter a
// API pública do módulo. `PipelineStage[]` é estruturalmente compatível.
export { stagesToColumns } from "@/contracts/pipe";

/**
 * Hook para criar uma nova etapa
 */
export function useCreatePipelineStage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async (stage: PipelineStageInsert) => {
      if (!teamMember?.organization_id) {
        throw new Error("Organização não encontrada");
      }

      // SCRUM-618: nada de semear defaults antes de criar — o seed é
      // server-side e lista vazia é estado legítimo. A etapa criada é a
      // primeira coluna real do board se o funil estava vazio.
      // A `position` que o editor manda é contada sobre as etapas VISÍVEIS, e
      // etapa excluída segue ocupando posição (soft delete `is_active=false`).
      // Quem decide o número é o funil inteiro — ver `proximaPosicaoDeEtapa`.
      // Sem isto o INSERT bate em `pipeline_stages_pipeline_id_position_key` e
      // o usuário lê "Já existe uma etapa com esse nome".
      const posicaoLivre = await proximaPosicaoDeEtapa({
        organizationId: teamMember.organization_id,
        pipelineType: stage.pipeline_type,
      });

      const { data, error } = await supabase
        .from("pipeline_stages")
        .insert({
          ...stage,
          position: posicaoLivre,
          organization_id: teamMember.organization_id,
        })
        .select()
        .single();

      if (error) {
        const conflito = mensagemDeConflitoDeEtapa(error);
        if (conflito) throw new Error(conflito);
        throw error;
      }
      return data as PipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

/**
 * Hook para atualizar uma etapa
 */
export function useUpdatePipelineStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      pipeline_type,
      ...updates
    }: {
      id: string;
      // StageFamily, não PipelineType: o editor compartilhado também edita as
      // etapas do resíduo Carteira (SCRUM-618). Usado só como chave de cache.
      pipeline_type: StageFamily;
      name?: string;
      color?: string;
      position?: number;
      is_active?: boolean;
      is_final_positive?: boolean;
      is_final_negative?: boolean;
      /**
       * ADR-0017 §1 — papel semântico governado. Vindo do modal de etapa é
       * sempre escolha explícita do admin (won/lost permitido — confirmação
       * humana). O classifier (#991) NUNCA escreve won/lost por este caminho.
       */
      stage_role?: import("@/contracts/pipe").StageRole;
      auto_move_min_days?: number | null;
      auto_move_max_days?: number | null;
      target_pipe_type?: string | null;
      target_stage_key?: string | null;
      target_pipeline_id?: string | null;
      target_stage_id?: string | null;
      checklist_template_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as PipelineStage;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}


/**
 * O funil de sistema por trás de uma família de etapa — ou null quando a
 * família é resíduo Carteira (D9): carteira nunca teve linha em `pipelines`,
 * então não há id a resolver (mesmo null que o resolve devolvia antes).
 */
function asSystemPipelineType(family: StageFamily): PipelineType | null {
  return family === "whatsapp" || family === "confirmacao" || family === "propostas"
    ? family
    : null;
}

/**
 * Resolve o pipeline_id do pipe de sistema (org + slug + type=system).
 * Usado pela migração de leads no delete de etapa.
 */
async function resolveSystemPipelineId(
  organizationId: string,
  slug: PipelineType,
): Promise<string | null> {
  const { data } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .eq("type", "system")
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Conta quantos leads estão em cada etapa de um pipe (por stage_key).
 * Alimenta a UI de delete: se a etapa tem leads, exige destino de migração
 * antes de desativar (senão os leads viram "fantasmas" — caem numa etapa que
 * o Kanban não renderiza). Ver `useDeletePipelineStage`.
 */
export function usePipelineStageLeadCounts(
  pipelineType: StageFamily | null,
  /**
   * SCRUM-636 (D3): id explícito do funil — o caminho canônico pós-626. Quando
   * presente, dispensa a resolução por família e serve QUALQUER funil (custom
   * incluso, que não tem família). Sem ele, o comportamento antigo permanece.
   */
  explicitPipelineId?: string | null,
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: [
      "pipeline_stage_lead_counts",
      explicitPipelineId ?? pipelineType,
      organizationId,
    ],
    queryFn: async () => {
      if (!organizationId) return {} as Record<string, number>;

      const systemType = pipelineType ? asSystemPipelineType(pipelineType) : null;
      const pipelineId =
        explicitPipelineId ??
        (systemType ? await resolveSystemPipelineId(organizationId, systemType) : null);
      if (!pipelineId) return {} as Record<string, number>;

      const { data, error } = await supabase
        .from("pipeline_entries")
        .select("stage_key")
        .eq("pipeline_id", pipelineId);

      if (error) {
        console.warn("Error counting pipeline_entries per stage:", error.message);
        return {} as Record<string, number>;
      }

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const key = (row as { stage_key: string }).stage_key;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
    enabled: !!organizationId,
  });
}

/**
 * Hook para deletar/desativar uma etapa.
 *
 * Soft-delete (is_active=false) preserva histórico. PORÉM, se a etapa ainda tem
 * leads, eles precisam ser migrados para uma etapa ativa ANTES de desativar —
 * caso contrário ficam num stage_key que o Kanban não renderiza (leads
 * "fantasmas"). `migrateToStageKey` é obrigatório quando há leads na etapa.
 */
export function useDeletePipelineStage() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      id,
      pipeline_type,
      stageKey,
      migrateToStageKey,
      pipelineId: explicitPipelineId,
    }: {
      id: string;
      /**
       * Família de sistema/carteira — usada como chave de cache e, na ausência
       * de `pipelineId`, para resolver o funil. Funil custom não tem família:
       * passa `pipelineId` e omite esta.
       */
      pipeline_type?: StageFamily;
      stageKey: string;
      migrateToStageKey?: string;
      /**
       * SCRUM-636 (D3): id explícito do funil — serve qualquer espécie. Com
       * ele, a migração de cards e a contagem valem também para funil custom
       * (antes o delete custom desativava a etapa SEM migrar os cards).
       */
      pipelineId?: string | null;
    }) => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Organização não encontrada");

      // Guarda F0 (funis-unificacao §4.4): etapa referenciada por regra de
      // disparo automático não pode ser removida — o slug/id dela é consumido
      // a jusante (dispatch de WhatsApp). Bloqueia ANTES de migrar leads. O
      // editor único (D3/SCRUM-636) mostra o bloqueio na UI antes de chegar
      // aqui; esta recusa segue como cinto para qualquer outro chamador.
      const { count: dispatchRuleCount, error: rulesError } = await supabase
        .from("pipe_dispatch_rules")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("pipeline_stage_id", id)
        .eq("is_active", true);

      if (rulesError) {
        throw new Error(
          `Não foi possível verificar regras de disparo desta etapa (${rulesError.message}). Remoção bloqueada por segurança.`,
        );
      }
      if ((dispatchRuleCount ?? 0) > 0) {
        throw new Error(
          `Esta etapa é alvo de ${dispatchRuleCount} regra(s) de disparo automático ativa(s). ` +
            `Desative ou reaponte essas regras nas configurações do funil antes de remover a etapa.`,
        );
      }

      const systemType = pipeline_type ? asSystemPipelineType(pipeline_type) : null;
      const pipelineId =
        explicitPipelineId ??
        (systemType ? await resolveSystemPipelineId(organizationId, systemType) : null);

      // Migrar leads que ainda estão nesta etapa antes de desativar.
      if (pipelineId) {
        const { count, error: countError } = await supabase
          .from("pipeline_entries")
          .select("id", { count: "exact", head: true })
          .eq("pipeline_id", pipelineId)
          .eq("stage_key", stageKey);

        if (countError) throw countError;

        if ((count ?? 0) > 0) {
          if (!migrateToStageKey) {
            throw new Error(
              `Esta etapa tem ${count} lead(s). Escolha uma etapa de destino para migrar antes de remover.`,
            );
          }
          if (migrateToStageKey === stageKey) {
            throw new Error("A etapa de destino deve ser diferente da etapa removida.");
          }

          const { error: migrateError } = await supabase
            .from("pipeline_entries")
            .update({ stage_key: migrateToStageKey, updated_at: new Date().toISOString() })
            .eq("pipeline_id", pipelineId)
            .eq("stage_key", stageKey);

          if (migrateError) throw migrateError;
        }
      }

      // Ao invés de deletar, desativamos a etapa para preservar dados históricos
      const { error } = await supabase
        .from("pipeline_stages")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Chaves de SISTEMA (por família) — comportamento histórico.
      if (variables.pipeline_type) {
        queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
        queryClient.invalidateQueries({ queryKey: ["pipeline_entries", variables.pipeline_type] });
      }
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
      queryClient.invalidateQueries({
        queryKey: ["pipeline_stage_lead_counts", variables.pipelineId ?? variables.pipeline_type],
      });
      // Chaves UNIFICADAS/CUSTOM (por id) — SCRUM-636: o mesmo delete serve o
      // funil custom, cujas telas leem por estas chaves. Sem elas, a etapa
      // removida continuaria renderizando até o debounce do realtime.
      if (variables.pipelineId) {
        queryClient.invalidateQueries({ queryKey: ["custom_pipeline_stages", variables.pipelineId] });
        queryClient.invalidateQueries({ queryKey: ["funil-stages", variables.pipelineId] });
        queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries", variables.pipelineId] });
        queryClient.invalidateQueries({ queryKey: ["custom_pipe_stage_counts", variables.pipelineId] });
        queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts", variables.pipelineId] });
      }
    },
  });
}

/**
 * Hook para reordenar etapas
 */
export function useReorderPipelineStages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeline_type,
      stages,
    }: {
      pipeline_type: StageFamily;
      stages: { id: string; position: number }[];
    }) => {
      // SCRUM-616: UNIQUE (pipeline_id, position) tornou o UPDATE por linha
      // inviável (cada request é uma transação; a permutação transita por
      // posições ocupadas). A RPC faz a permutação em statement único e já
      // grava updated_at.
      const ordered = [...stages].sort((a, b) => a.position - b.position);
      const { error } = await supabase.rpc("reorder_pipeline_stages" as never, {
        p_stage_ids: ordered.map((s) => s.id),
      } as never);
      if (error) throw error;

      return true;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
    },
  });
}

// `getPipelineTypeName` movido para contracts (puro). Re-exportado para manter
// a API pública do módulo.
export { getPipelineTypeName, getStageFamilyName } from "@/contracts/pipe";

/**
 * Converte etapas do banco para o formato {value, label} usado nos selects/checkboxes.
 * Substitui as constantes hardcoded PIPE_STAGES, PIPE_CONFIRMACAO_STAGES, etc.
 */
export function stagesToSelectOptions(
  stages: PipelineStage[] | { id: string; stage_key: string; name: string; color: string | null }[] | undefined
): { value: string; label: string }[] {
  if (!stages) return [];
  return stages.map((s) => ({
    value: "stage_key" in s ? s.stage_key : s.id,
    label: s.name,
  }));
}

/**
 * Hook que retorna etapas dinâmicas formatadas para selects/checkboxes.
 * Substituição direta de PIPE_STAGES[pipelineType].
 */
export function usePipelineStageOptions(pipelineType: PipelineType) {
  const { data: stages, isLoading } = usePipelineStages(pipelineType);
  const options = stagesToSelectOptions(stages);
  return { options, isLoading, stages };
}

/**
 * Hook que retorna etapas de TODOS os pipes formatadas para selects.
 * Substituição direta de PIPE_STAGES (objeto completo).
 */
export function useAllPipelineStageOptions() {
  const whatsapp = usePipelineStageOptions("whatsapp");
  const confirmacao = usePipelineStageOptions("confirmacao");
  const propostas = usePipelineStageOptions("propostas");

  const isLoading = whatsapp.isLoading || confirmacao.isLoading || propostas.isLoading;

  const stagesByPipe: Record<string, { value: string; label: string }[]> = {
    whatsapp: whatsapp.options,
    confirmacao: confirmacao.options,
    propostas: propostas.options,
  };

  return { stagesByPipe, isLoading };
}

/**
 * Retorna a configuração de transição da etapa de sucesso de um pipe.
 * Busca a etapa com is_final_positive e retorna target_pipe_type/target_stage_key.
 */
export function getSuccessStageTransition(
  stages: PipelineStage[] | undefined
): { targetPipe: PipelineType; targetStage: string } | null {
  if (!stages) return null;
  const successStage = stages.find((s) => s.is_final_positive);
  if (!successStage?.target_pipe_type || !successStage?.target_stage_key) return null;
  return {
    targetPipe: successStage.target_pipe_type as PipelineType,
    targetStage: successStage.target_stage_key,
  };
}
