import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { PipelineType, PipelineStage, PipelineStageInsert, DefaultStage } from "@/contracts/pipe";
import { DEFAULT_STAGES } from "@/contracts/pipe";

// `PipelineType` + `PipelineStage(Insert)` + `getPipelineTypeName` +
// `stagesToColumns` têm definição canônica em contracts (puros, sem
// side-effect) — quebra import direto leads→pipelines. Re-exportados aqui
// mantendo a API pública inalterada.
export type { PipelineType, PipelineStage, PipelineStageInsert, DefaultStage };
// DEFAULT_STAGES: constante PURA movida para `@/contracts/pipe` (quebra ciclo
// communication/leads -> pipelines via barrel). Re-exportada aqui p/ API estável.
export { DEFAULT_STAGES };

// Controle para garantir que etapas padrão existam no banco (uma vez por sessão)
const defaultsEnsuredForSession = new Set<string>();

/**
 * Destrava a semeadura de etapas para a org.
 *
 * Necessário depois de ATIVAR um funil de sistema: a trava é por organização,
 * não por tipo, então sem isto o funil recém-ativado nasceria sem etapa
 * nenhuma até o usuário recarregar a aba — o `ensure` já teria rodado nesta
 * sessão, quando aquele tipo ainda não estava no registro.
 */
export function resetDefaultStagesEnsureCache(organizationId: string) {
  defaultsEnsuredForSession.delete(organizationId);
}


/**
 * Garante que as etapas padrão de TODOS os pipelines existam no banco para uma organização.
 * Usa upsert com ignoreDuplicates (ON CONFLICT DO NOTHING), então é idempotente e segura.
 */
async function ensureDefaultStagesInDb(
  organizationId: string,
  tiposHabilitados: ReadonlySet<string>,
) {
  const allStages: Record<string, unknown>[] = [];

  // Carteira fora da semeadura: `upsell_base`/`upsell_gestao` foram aposentados
  // (ADR-0023 §8, migration 20270805000010). Esta função é a torneira VIVA —
  // é ela, e não `create_default_pipeline_stages`, que dá etapas às orgs novas
  // (Liris e Bolivar nasceram com as 8 etapas de `propostas` do DEFAULT_STAGES,
  // não com as 7 da função SQL). Continuar semeando carteira aqui recriaria,
  // ATIVA, em toda org nova, exatamente o que a migration desativou em 98.
  //
  // `DEFAULT_STAGES` MANTÉM as duas famílias de propósito: é o fallback em
  // memória de `buildFallbackStages` que segura `/upsell` de pé enquanto a
  // rota não for terminada ou enterrada (decisão em aberto, ADR-0005).
  // 🚨 Só semeia o que a org DECLARA ter em `pipeline_display_config`. Esta era
  // a torneira nº 3: o upsert varria os três tipos incondicionalmente, então
  // apagar as etapas de um funil e recarregar a página as trazia de volta —
  // era o que tornava a exclusão impossível pelo lado do front. Ver a migration
  // 20270831000000, que fechou as duas torneiras equivalentes no banco.
  for (const pipeType of ["whatsapp", "confirmacao", "propostas"] as PipelineType[]) {
    if (!tiposHabilitados.has(pipeType)) continue;
    for (let i = 0; i < DEFAULT_STAGES[pipeType].length; i++) {
      const stage = DEFAULT_STAGES[pipeType][i];
      allStages.push({
        organization_id: organizationId,
        pipeline_type: pipeType,
        stage_key: stage.id,
        name: stage.title,
        color: stage.color,
        position: i,
        is_active: true,
        is_final_positive: stage.is_final_positive ?? false,
        is_final_negative: stage.is_final_negative ?? false,
        target_pipe_type: stage.target_pipe_type ?? null,
        target_stage_key: stage.target_stage_key ?? null,
      });
    }
  }

  if (allStages.length === 0) return;

  const { error } = await supabase
    .from("pipeline_stages")
    .upsert(allStages, {
      onConflict: "organization_id,pipeline_type,stage_key",
      ignoreDuplicates: true,
    });

  if (error) {
    console.warn("Error ensuring default stages via upsert:", error.message);
  }
}

/**
 * Os tipos de funil de sistema que a org tem, lidos do registro.
 *
 * Leitura direta (não o hook `usePipelineDisplayConfig`) de propósito: isto roda
 * DENTRO do `queryFn`, onde não se pode chamar hook, e `pipeline_stages` não
 * pode depender do ciclo de vida de outra query para decidir se semeia.
 *
 * ⚠️ Em erro devolve conjunto VAZIO, não "todos". Falhar para o lado de não
 * semear é o certo: um erro transitório de rede não pode ressuscitar um funil
 * que a org excluiu.
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
  return DEFAULT_STAGES[pipelineType].map((stage, index): PipelineStage => ({
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
    // NOT NULL, default 'open' no banco. `ensureDefaultStagesInDb` não escreve
    // este campo, então a linha real destas mesmas etapas também nasce 'open'.
    // won/lost é papel governado (ADR-0017 §1), nunca derivado de is_final_*.
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
        // Só os três tipos que a org registra em `pipeline_display_config`
        // passam por aqui. `upsell_base`/`upsell_gestao` NÃO são tipos daquele
        // registro (lá o tipo é `upsell`, sem sufixo) e nunca foram semeados
        // por `ensureDefaultStagesInDb` — mantêm o comportamento antigo, com
        // fallback. Alargar o portão para eles mudaria a rota /upsell, que não
        // faz parte deste trabalho.
        const tipoRegistravel =
          pipelineType === "whatsapp" ||
          pipelineType === "confirmacao" ||
          pipelineType === "propostas";

        if (tipoRegistravel) {
          const tiposHabilitados = await lerTiposHabilitados(organizationId);

          // 🚨 Torneira nº 4. A org não tem este funil (nunca teve, ou
          // excluiu): devolver lista VAZIA, nunca `fallbackStages`. Enquanto
          // este ramo caía no fallback, o funil excluído continuava
          // renderizando com as etapas padrão em memória — o banco ficava
          // limpo e a tela mentia.
          if (!tiposHabilitados.has(pipelineType)) return [];

          // Semeia as etapas padrão uma vez por sessão, só dos tipos que a org
          // declara ter.
          const ensureKey = `${organizationId}`;
          if (!defaultsEnsuredForSession.has(ensureKey)) {
            defaultsEnsuredForSession.add(ensureKey);
            await ensureDefaultStagesInDb(organizationId, tiposHabilitados);
          }
        }

        const { data, error } = await supabase
          .from("pipeline_stages")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("pipeline_type", pipelineType)
          .eq("is_active", true)
          .order("position", { ascending: true });

        // Se houver erro (tabela não existe, etc), usa fallback
        if (error) {
          console.warn("Pipeline stages table not available, using defaults:", error.message);
          return fallbackStages;
        }

        // Se não houver etapas (mesmo após ensure), usar fallback
        if (!data || data.length === 0) {
          return fallbackStages;
        }

        return data as PipelineStage[];
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

      // Garantir que etapas padrão existam no banco antes de criar nova etapa.
      // Isso previne o bug onde criar uma etapa fazia as padrão (fallback) sumirem,
      // pois o fallback só é ativado quando não há nenhuma etapa no banco.
      //
      // Passa pelo mesmo portão do registro: criar uma etapa num funil não pode
      // ressuscitar as etapas padrão de um funil VIZINHO que a org excluiu.
      await ensureDefaultStagesInDb(
        teamMember.organization_id,
        await lerTiposHabilitados(teamMember.organization_id),
      );

      const { data, error } = await supabase
        .from("pipeline_stages")
        .insert({
          ...stage,
          organization_id: teamMember.organization_id,
        })
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
      pipeline_type: PipelineType;
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
export function usePipelineStageLeadCounts(pipelineType: PipelineType) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["pipeline_stage_lead_counts", pipelineType, organizationId],
    queryFn: async () => {
      if (!organizationId) return {} as Record<string, number>;

      const pipelineId = await resolveSystemPipelineId(organizationId, pipelineType);
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
    }: {
      id: string;
      pipeline_type: PipelineType;
      stageKey: string;
      migrateToStageKey?: string;
    }) => {
      const organizationId = teamMember?.organization_id;
      if (!organizationId) throw new Error("Organização não encontrada");

      const pipelineId = await resolveSystemPipelineId(organizationId, pipeline_type);

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
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["all_pipeline_stages"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_stage_lead_counts", variables.pipeline_type] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries", variables.pipeline_type] });
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
      pipeline_type: PipelineType;
      stages: { id: string; position: number }[];
    }) => {
      const updates = stages.map((stage) =>
        supabase
          .from("pipeline_stages")
          .update({ position: stage.position, updated_at: new Date().toISOString() })
          .eq("id", stage.id)
      );

      const results = await Promise.all(updates);
      const errors = results.filter((r) => r.error);

      if (errors.length > 0) {
        throw errors[0].error;
      }

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
export { getPipelineTypeName } from "@/contracts/pipe";

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
