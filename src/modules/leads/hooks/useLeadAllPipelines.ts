import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, isVirtualTeamMember } from "@/modules/identity";
import { usePipeOps } from "../pipe-ops";

// ─── Types ───────────────────────────────────────────────────

export interface StandardPipelineStatus {
  type: "standard";
  pipeType: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  label: string;
  color: string;
  /** id do pipeline (tabela pipelines) — alvo do add. Null p/ upsell (legacy). */
  pipelineDbId: string | null;
  pipeId: string | null;
  currentStage: string | null;
  currentStageLabel: string | null;
  stages: { id: string; label: string; color: string; role?: string | null }[];
}

export interface CustomPipelineStatus {
  type: "custom";
  pipelineId: string;
  pipelineName: string;
  pipelineColor: string;
  pipelineIcon: string;
  entryId: string | null;
  currentStageId: string | null;
  currentStageName: string | null;
  stages: { id: string; name: string; color: string; position: number; role?: string | null }[];
}

export type PipelineStatus = StandardPipelineStatus | CustomPipelineStatus;

/**
 * SCRUM-637: `pipeType` de funil de sistema É o slug (`pipelines.slug`) — o
 * sentinel legado "qualificacao" morreu junto com os mapas de tradução
 * (SYSTEM_SLUG_TO_PIPE / SYSTEM_RAIL_REF / PIPE_TYPE_TO_DISPLAY, todos viraram
 * identidade). Resta só o resíduo Carteira (D9): as etapas dela vivem em
 * `pipeline_stages.pipeline_type = 'upsell_base'`, sem FK de funil.
 */
const PIPE_TYPE_MAP: Record<string, string> = {
  upsell: "upsell_base",
};

const SYSTEM_SLUGS = ["whatsapp", "confirmacao", "propostas"] as const;

// ─── Main hook: unified pipeline_entries query ────────

export function useLeadAllPipelines(leadId: string | null) {
  const { useCustomPipelines } = usePipeOps();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: customPipelines = [] } = useCustomPipelines();
  const orgId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["lead_all_pipelines", leadId, orgId, customPipelines.map((p) => p.id).join(",")],
    queryFn: async (): Promise<PipelineStatus[]> => {
      if (!leadId || !orgId) return [];

      const [
        { data: allEntries },
        { data: dynamicStages },
        { data: allPipelines },
        { data: customStagesAll },
        { data: pipeUpsell },
      ] = await Promise.all([
        // Ordem idêntica à de `readActivePipelineEntry`
        // (`pipelines/hooks/model/usePipelineEntries.ts`) e à de `readPipeEntries`
        // (`supabase/functions/_shared/pipeline-adapter.ts`): aberto antes de
        // fechado, depois o mais recente. É o que faz o PRIMEIRO negócio de cada
        // funil aqui ser o mesmo que o kanban e o Copilot chamam de corrente.
        (supabase.from as any)("pipeline_entries")
          .select("id, pipeline_id, stage_key, closed_at, stage_changed_at, created_at")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .order("closed_at", { ascending: false, nullsFirst: true })
          .order("stage_changed_at", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        supabase
          .from("pipeline_stages")
          .select("pipeline_type, stage_key, name, color, position, stage_role")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
        (supabase.from as any)("pipelines")
          .select("id, slug, type, name, color, icon")
          .eq("organization_id", orgId)
          .eq("is_active", true),
        supabase
          .from("custom_pipeline_stages")
          .select("id, pipeline_id, name, color, position, stage_key, stage_role")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .order("position", { ascending: true }),
        // Upsell still lives in its own table (no sync trigger yet)
        supabase
          .from("upsell")
          .select("id, status")
          .eq("lead_id", leadId)
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);

      const entries = allEntries ?? [];
      const pipelines = (allPipelines ?? []) as { id: string; slug: string; type: string; name: string; color: string; icon: string }[];

      // Build stage lookup
      const stagesByDbType = new Map<string, { id: string; label: string; color: string; role: string | null }[]>();
      (dynamicStages || []).forEach((s) => {
        const arr = stagesByDbType.get(s.pipeline_type) || [];
        arr.push({ id: s.stage_key, label: s.name, color: s.color || "#64748b", role: (s as { stage_role?: string | null }).stage_role ?? null });
        stagesByDbType.set(s.pipeline_type, arr);
      });

      const getStages = (pipeType: string) => stagesByDbType.get(PIPE_TYPE_MAP[pipeType] || pipeType) || [];

      /**
       * Map pipeline_id → TODAS as entries daquele funil, não uma só.
       *
       * Era `new Map(entries.map(e => [e.pipeline_id, e]))`: com dois negócios no
       * mesmo funil (o que o M1 passa a permitir — recompra) a segunda linha
       * sobrescrevia a primeira e um dos negócios sumia da tela. Não é só ruído
       * visual: `DealDetailDialog` acha o funil do negócio por
       * `pipelines.find(p => p.pipeId === entryId)`, então o negócio descartado
       * abria o drawer no estado "negócio que sumiu embaixo do usuário".
       *
       * O critério de QUAL é o corrente continua sendo o mesmo do resto do
       * sistema — só que aqui ele vira ORDEM, não filtro: quem consome com
       * `.find(...)` (ex.: `whatsappEntry` em `CrossPipePanel`) pega o corrente,
       * e quem itera (as rails da seção "Negócios") vê os N.
       */
      const entriesByPipelineId = new Map<string, any[]>();
      for (const e of entries as any[]) {
        const arr = entriesByPipelineId.get(e.pipeline_id);
        if (arr) arr.push(e);
        else entriesByPipelineId.set(e.pipeline_id, [e]);
      }

      /**
       * Negócios de um funil, aberto antes de fechado.
       *
       * O `ORDER BY` já entrega assim; a partição é estável e refaz em JS só o
       * passo 1 de `pickActiveEntry` (`_shared/pipeline-adapter.ts`), pelo mesmo
       * motivo de lá — se `nullsFirst` mudar de comportamento, a escolha do
       * corrente continua certa. Os desempates de recência seguem vindo do SQL.
       */
      const dealsOf = (pipelineId: string | null | undefined): any[] => {
        if (!pipelineId) return [];
        const rows = entriesByPipelineId.get(pipelineId) ?? [];
        return [
          ...rows.filter((e) => e.closed_at == null),
          ...rows.filter((e) => e.closed_at != null),
        ];
      };

      // Map pipeline slug → pipeline
      const pipelineBySlug = new Map(pipelines.map((p) => [p.slug, p]));

      const results: PipelineStatus[] = [];

      // System pipelines — uma linha POR NEGÓCIO; sem negócio, uma linha vazia
      // (é ela que os consumidores leem como "dá pra abrir negócio aqui").
      for (const slug of SYSTEM_SLUGS) {
        const pipeline = pipelineBySlug.get(slug);
        const stages = getStages(slug);
        // Nome/cor REAIS do registro `pipelines` (funil renomeável/colorível);
        // fallback pros rótulos históricos enquanto a linha não chegou.
        const label =
          pipeline?.name ??
          (slug === "whatsapp" ? "Qualificação" : slug === "confirmacao" ? "Confirmação" : "Propostas");
        const color =
          pipeline?.color ??
          (slug === "whatsapp" ? "#6366f1" : slug === "confirmacao" ? "#22c55e" : "#f59e0b");
        const base = {
          type: "standard" as const,
          pipeType: slug,
          label,
          color,
          pipelineDbId: pipeline?.id ?? null,
          stages,
        };

        const deals = dealsOf(pipeline?.id);
        if (deals.length === 0) {
          results.push({ ...base, pipeId: null, currentStage: null, currentStageLabel: null });
          continue;
        }
        for (const entry of deals) {
          results.push({
            ...base,
            pipeId: entry.id || null,
            currentStage: entry.stage_key || null,
            currentStageLabel: stages.find((s) => s.id === entry.stage_key)?.label || null,
          });
        }
      }

      // Upsell (still legacy — no sync trigger yet)
      results.push({
        type: "standard",
        pipeType: "upsell",
        label: "Carteira",
        color: "#3b82f6",
        pipelineDbId: null, // upsell é tabela legacy própria — não adicionável via pipeline_entries
        pipeId: pipeUpsell?.id || null,
        currentStage: pipeUpsell?.status || null,
        currentStageLabel: getStages("upsell").find((s) => s.id === pipeUpsell?.status)?.label || null,
        stages: getStages("upsell"),
      });

      // Custom pipelines
      const stagesByPipeline = new Map<string, typeof customStagesAll>();
      (customStagesAll || []).forEach((s) => {
        const arr = stagesByPipeline.get(s.pipeline_id) || [];
        arr.push(s);
        stagesByPipeline.set(s.pipeline_id, arr);
      });

      for (const pipeline of customPipelines) {
        const stages = (stagesByPipeline.get(pipeline.id) || []).sort((a, b) => a.position - b.position);
        const base = {
          type: "custom" as const,
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          pipelineColor: pipeline.color,
          pipelineIcon: pipeline.icon,
          stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color ?? "#64748b", position: s.position ?? 0, role: (s as { stage_role?: string | null }).stage_role ?? null })),
        };

        // O M1 também derrubou `custom_pipe_entries_pipeline_id_lead_id_key`, então
        // recompra em funil customizado tem o mesmo N que o system.
        const deals = dealsOf(pipeline.id);
        if (deals.length === 0) {
          results.push({ ...base, entryId: null, currentStageId: null, currentStageName: null });
          continue;
        }
        for (const entry of deals) {
          const currentStage = stages.find((s) => s.stage_key === entry.stage_key || s.id === entry.stage_key);
          results.push({
            ...base,
            entryId: entry.id || null,
            currentStageId: currentStage?.id || null,
            currentStageName: currentStage?.name || null,
          });
        }
      }

      return results;
    },
    enabled: !!leadId && !!orgId,
  });
}

// ─── Mutation: add lead to a standard pipeline ────────────────
// Writes to legacy tables → sync triggers push to pipeline_entries

/**
 * Recusa dono que não é da org. Função pura de dados — sem React, de propósito:
 * importar o barril `@/modules/identity` num componente de board arrasta um
 * grafo grande e estourou o orçamento de 5s dos testes vizinhos.
 *
 * As policies dos pipes validam `organization_id` da linha, nunca o org do
 * membro referenciado; a FK garante que o uuid existe, não de quem ele é. Ver
 * M6 em `08 — Backlog/em-progresso/lead-negocio-migrations-db` — o conserto
 * definitivo é no banco, isto é defesa em profundidade.
 */
export async function assertMemberInOrg(
  memberId: string,
  organizationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Responsável não pertence a esta organização");
}

export interface AddLeadToStandardPipeVars {
  leadId: string;
  pipeType: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  stageId: string;
  /**
   * Dono do negócio (`team_members.id`). Ausente = quem está criando, que era
   * o comportamento único antes do modal de novo negócio existir.
   */
  ownerId?: string | null;
  /** Só `propostas` tem coluna de valor. */
  saleValue?: number | null;
  /** Só `confirmacao` — os lembretes D-5/D-3/D-1 dependem deste carimbo. */
  meetingDate?: string | null;
  notes?: string | null;
}

export function useAddLeadToStandardPipe() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      leadId,
      pipeType,
      stageId,
      ownerId,
      saleValue,
      meetingDate,
      notes,
    }: AddLeadToStandardPipeVars) => {
      if (!teamMember?.organization_id) throw new Error("Organização não encontrada");

      // Virtual master team_members carry a non-UUID id ("master-virtual-<uuid>")
      // and must never be written into uuid FK columns (responsible_id/sdr_id/closer_id).
      const currentMemberId = isVirtualTeamMember(teamMember.id) ? null : teamMember.id;
      // Mesmo guard vale pro dono escolhido no modal: master virtual não é FK.
      const chosenOwnerId =
        ownerId && !isVirtualTeamMember(ownerId) ? ownerId : null;

      /**
       * Dono escolhido tem que ser da MESMA org.
       *
       * As policies dos pipes checam `organization_id` da linha — nenhuma valida
       * o org do membro referenciado em `responsible_id`/`sdr_id`/`closer_id`. A
       * FK garante que o uuid existe, não de quem ele é. Sem esta checagem, um
       * `ownerId` de outra org entra numa linha desta org, e qualquer join que
       * resolve responsável → `team_members.name` passa a exibir o nome de um
       * membro de fora — vazamento cross-tenant, além de atribuição suja.
       *
       * Guarda de cliente é defesa em profundidade, não a última: o conserto
       * definitivo é no banco (CHECK/trigger comparando as orgs). Registrado em
       * `08 — Backlog/em-progresso/lead-negocio-migrations-db`.
       */
      if (chosenOwnerId) await assertMemberInOrg(chosenOwnerId, teamMember.organization_id);

      const memberId = chosenOwnerId ?? currentMemberId;
      const trimmedNotes = notes?.trim() ? notes.trim() : null;

      /**
       * ADR-0023 decisões 3 e 9 — abrir negócio é UM ato, não dois.
       *
       * Antes daqui saíam três `insert` nas views de compatibilidade, e cada um
       * criava só a POSIÇÃO. A identidade (`deals`) nunca nascia: o único
       * `INSERT INTO deals` do repo vivia no hook de `/negocios`, que a fatia 2
       * apagou. Resultado: o "negócio" não tinha título próprio — a lista de
       * Leads derivava um na leitura, a partir do nome do funil, que é
       * exatamente o que a decisão 9 rejeita por produzir dezenas de milhares de
       * negócios chamados "Qualificação".
       *
       * A RPC `abrir_negocio` faz as duas escritas no corpo de uma função só:
       * ou nascem identidade e posição ligadas por `deal_id`, ou nenhuma. Do
       * cliente seriam duas chamadas, e uma falha no meio deixaria card órfão —
       * o mesmo estado que o backfill do L3 existe para consertar, refeito a
       * cada erro de rede.
       *
       * A RPC é `SECURITY INVOKER`: a permissão continua sendo exatamente a de
       * criar o card. A pergunta em aberto ("quem pode abrir um negócio?") segue
       * respondível depois, mexendo em policy.
       *
       * `as never` no nome: `abrir_negocio` ainda não está em
       * `integrations/supabase/types.ts`, que é gerado e só é regenerado depois
       * do apply em prod (regenerar a partir de branch efêmera corrompe o
       * arquivo — ver CLAUDE.md).
       */
      if (pipeType !== "upsell") {
        const { error } = await supabase.rpc("abrir_negocio" as never, {
          p_lead_id: leadId,
          // SCRUM-637: `pipeType` já É o slug que a RPC entende — o mapa
          // RPC_PIPE virou identidade e morreu.
          p_pipe: pipeType,
          p_stage: stageId,
          p_owner_id: memberId,
          p_value: pipeType === "propostas" ? saleValue ?? null : null,
          p_meeting_date: pipeType === "confirmacao" ? meetingDate ?? null : null,
          p_notes: trimmedNotes,
          p_title: null,
          // Procedência (ADR-0030 §4): este caminho é o clique na interface.
          // Passar explicitamente, e não deixar no default, é o que impede que o
          // Negócio de gente fique indistinguível do de robô. O default da RPC é
          // NULL de propósito — 'human' por omissão etiquetaria como humano tudo
          // que esquecesse de informar.
          p_source: "human",
        } as never);
        if (error) throw error;
      } else if (pipeType === "upsell") {
        // Carteira entra por regra própria (ADR-0023 decisão 8), não por esta
        // porta — a RPC recusa `upsell` de propósito.
        const { error } = await supabase.from("upsell").insert({
          lead_id: leadId,
          status: stageId,
          organization_id: teamMember.organization_id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
      // A camada de negócio da lista de Leads passa a ter linha nova em `deals`
      // a cada abertura — sem isto, o negócio existe no banco e a lista segue
      // mostrando o estado anterior até perder e recuperar o foco. Mesmo par que
      // `useCrossPipeMove` invalida ao mover etapa.
      queryClient.invalidateQueries({ queryKey: ["leads-deals"] });
      queryClient.invalidateQueries({ queryKey: ["leads-sales-metrics"] });
    },
  });
}

// ─── Mutation: move lead in a standard pipeline ────────────────

export function useMoveLeadInStandardPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeId,
      pipeType,
      newStageId,
    }: {
      pipeId: string;
      pipeType: "whatsapp" | "confirmacao" | "propostas" | "upsell";
      newStageId: string;
    }) => {
      const table =
        pipeType === "whatsapp" ? "pipe_whatsapp"
        : pipeType === "confirmacao" ? "pipe_confirmacao"
        : pipeType === "propostas" ? "pipe_propostas"
        : "upsell";

      const { error } = await supabase
        .from(table)
        .update({ status: newStageId })
        .eq("id", pipeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}

// ─── Mutation: remove lead from a standard pipeline ────────────

export function useRemoveLeadFromStandardPipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeId,
      pipeType,
    }: {
      pipeId: string;
      pipeType: "whatsapp" | "confirmacao" | "propostas" | "upsell";
    }) => {
      const table =
        pipeType === "whatsapp" ? "pipe_whatsapp"
        : pipeType === "confirmacao" ? "pipe_confirmacao"
        : pipeType === "propostas" ? "pipe_propostas"
        : "upsell";

      const { error } = await supabase.from(table).delete().eq("id", pipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["upsell"] });
    },
  });
}
