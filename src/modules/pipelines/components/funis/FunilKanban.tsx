import { useMemo, useState, type ReactNode } from "react";
import { DraggableKanbanBoard, type KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { LeadCard, type LeadCardData, type LeadMetrics } from "@/modules/leads";
import { StageWorkflowsBadge } from "@/modules/pipelines/components/kanban/StageWorkflowsBadge";
import { MergedFunnelCardActions } from "@/modules/pipelines/components/kanban/MergedFunnelCardActions";
import { useCustomPipeStageWorkflows, useCustomPipeWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import type { StageData } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import { useCanDo } from "@/modules/identity";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import type { CustomPipelineStage } from "@/contracts/pipe";

/**
 * Card de funil na página unificada — o shape que `get_pipeline_page` devolve,
 * já achatado por `flattenMetadata` (o mesmo dos boards de sistema).
 */
export interface FunilEntry {
  id: string;
  lead_id: string | null;
  stage_key: string;
  notes: string | null;
  created_at: string;
  /** Funil mergeado (ADR-0004): dados de reunião achatados do metadata. */
  meeting_date?: string | null;
  is_confirmed?: boolean;
  metadata?: Record<string, unknown> | null;
  lead?: {
    id: string;
    name: string | null;
    /** Código do cliente no ERP — projetado por `20270921000020`. */
    erp_code?: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    origin?: string | null;
    urgency?: string | null;
    faturamento?: string | null;
    avatar_url?: string | null;
    pre_qualification_tier?: string | null;
    qualification_tier?: string | null;
    responsible?: { name?: string | null; avatar_url?: string | null } | null;
    sdr?: { name?: string | null } | null;
    closer?: { name?: string | null } | null;
    lead_tags?: Array<{ tag?: { name?: string; color?: string | null } | null }>;
  } | null;
}

interface FunilKanbanProps {
  pipelineId: string;
  stages: CustomPipelineStage[];
  /** Dados paginados por `stage_key` (usePaginatedFunil). */
  stageData: Record<string, StageData>;
  onMove: (entryId: string, stage: CustomPipelineStage) => void;
  onRemoveEntry?: (entryId: string) => void;
  onClickEntry?: (entry: FunilEntry) => void;
  /**
   * Contadores por lead (comentários/checklists) — 2 queries batched sobre os
   * ids CARREGADOS (`useBatchedLeadMetrics`), mesmo custo que o board legado de
   * Qualificação pagava. Opcional: sem o mapa o card só omite os badges.
   */
  metricsMap?: Record<string, LeadMetrics>;
  /**
   * "Disparar" da barra de bulk abre o wizard de Disparo pré-semeado com a
   * seleção (fonte Manual) — porte das páginas de sistema. Sem o handler a
   * barra cai no QuickBlast interno (comportamento antigo do board custom).
   */
  onDisparar?: (leadIds: string[]) => void;
  /**
   * "Mover leads da etapa pra lixeira" (menu da coluna) — porte das páginas de
   * sistema; a página só o oferece onde o delete em massa existe (trio).
   */
  onDeleteAllLeads?: (stageKey: string, stageTitle: string) => void;
  /**
   * Badge de workflows da coluna. Workflows de funil de SISTEMA ainda são
   * configurados por pipe_type (slug) — a página injeta o badge legado aqui;
   * sem override, o badge por pipeline_id (funil custom) é usado.
   */
  renderStageBadge?: (col: { id: string; title: string }) => ReactNode;
}

function FunilStageBadge({
  pipelineId,
  stageKey,
  stageName,
  counts,
}: {
  pipelineId: string;
  stageKey: string;
  stageName: string;
  counts?: { total: number; active: number };
}) {
  const { data: workflows } = useCustomPipeStageWorkflows(pipelineId, stageKey);

  return (
    <StageWorkflowsBadge
      total={counts?.total ?? 0}
      active={counts?.active ?? 0}
      workflows={workflows}
      pipelineId={pipelineId}
      stageKey={stageKey}
      stageName={stageName}
    />
  );
}

/**
 * Board da página unificada `/funil/:slug` (SCRUM-632).
 *
 * Fork PAGINADO de `CustomPipelineKanban`: preserva a identidade visual do
 * kanban atual (DraggableKanbanBoard + LeadCard, mesmos tokens) e troca só a
 * fonte de dados — colunas alimentadas por `usePaginatedFunil`, com
 * `hasMore/onLoadMore` por coluna (mata o truncamento de 1.000 do board
 * custom). Na SCRUM-637 o board legado morre e este vira o único.
 *
 * Slots estruturados p/ 633/634 (paridade de sistema): filtros ricos entram
 * pela página (server-side, `PaginatedFilters`); saved views/bulk avançado/
 * métricas de funil se penduram aqui sem tocar na composição das colunas.
 */
export function FunilKanban({
  pipelineId,
  stages,
  stageData,
  onMove,
  onRemoveEntry,
  onClickEntry,
  metricsMap,
  onDisparar,
  onDeleteAllLeads,
  renderStageBadge,
}: FunilKanbanProps) {
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
  // Workflows pendurados no funil: para custom o trigger_config guarda o
  // pipeline_id + stage_key — a MESMA chave serve aqui. Funil de sistema não
  // guarda por pipeline_id (slot 633/634); a query volta vazia e o badge fica 0.
  const { data: workflowCounts = {} } = useCustomPipeWorkflowCounts(pipelineId);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);
  const bulk = useBulkSelection();

  // Destino do "Marcar perdido": papel PRIMEIRO, flag depois — em duas
  // passadas. Um `find` único com OR escolhe por acidente de posição: etapa de
  // falta marcada final_negative que vem antes ganharia da etapa `lost` real,
  // e o botão moveria o card pra onde ele já está (fix portado da main,
  // 46f27b2f — "falta a reunião deixa de contar como perda"). `stage_role` é o
  // mesmo critério que a métrica usa pra contar perda. Stages já chegam só
  // ativas (usePaginatedFunil filtra is_active).
  const lostStageKey = useMemo(
    () =>
      (stages.find((s) => s.stage_role === "lost") ??
        stages.find((s) => (s.stage_role ?? "open") === "open" && s.is_final_negative))
        ?.stage_key ?? null,
    [stages],
  );

  // Ordered lead ids (shift-select em range) — só o que está CARREGADO.
  const allLeadIds = useMemo(
    () =>
      stages.flatMap((s) =>
        ((stageData[s.stage_key]?.items ?? []) as FunilEntry[])
          .filter((e) => e.lead_id)
          .map((e) => e.lead_id as string),
      ),
    [stages, stageData],
  );

  // Papel semântico por `stage_key`, resolvido no CLIENTE a partir das etapas
  // que o board já carregou. É o que aposenta a lista de slugs chumbados do
  // card de reunião: `reuniao_marcada` numa org e `agendado` noutra são a
  // mesma coisa para o produto, e só `stage_role` sabe disso. Resolver aqui
  // mantém `get_pipeline_page` com a MESMA assinatura (S6).
  const stageRoleByKey = useMemo(
    () => new Map(stages.map((s) => [s.stage_key, s.stage_role ?? null])),
    [stages],
  );

  const transformToCard = (entry: FunilEntry): LeadCardData => {
    const lead = entry.lead;
    const responsibleName = lead?.responsible?.name || lead?.closer?.name || lead?.sdr?.name || null;
    const meetingDate =
      entry.meeting_date ?? (entry.metadata?.meeting_date as string | undefined) ?? null;
    return {
      id: entry.id,
      name: lead?.name || "Sem nome",
      erpCode: lead?.erp_code ?? null,
      company: lead?.company || null,
      phone: lead?.phone || null,
      email: lead?.email || null,
      origin: lead?.origin ?? undefined,
      urgency: lead?.urgency || null,
      faturamento: lead?.faturamento ?? null,
      responsible: responsibleName,
      preSaleResponsible: responsibleName
        ? { name: responsibleName, avatar_url: lead?.responsible?.avatar_url ?? null }
        : null,
      avatarUrl: lead?.avatar_url || null,
      // O RPC devolve o tier como texto livre; o card espera o enum — a RLS do
      // banco já garante o domínio (CHECK), então o cast é seguro.
      preQualTier: (lead?.pre_qualification_tier || null) as LeadCardData["preQualTier"],
      qualTier: (lead?.qualification_tier || null) as LeadCardData["qualTier"],
      tags: (lead?.lead_tags ?? [])
        .map((lt) => ({ name: lt.tag?.name ?? "", color: lt.tag?.color || "#888" }))
        .filter((t) => t.name),
      createdAt: entry.created_at,
      notes: entry.notes,
      leadId: entry.lead_id ?? undefined,
      metrics: entry.lead_id ? metricsMap?.[entry.lead_id] : undefined,
      // ── Reunião no card: os BOTÕES de confirmação continuam gateados pela
      // flag `merged_opportunity_funnel` dentro do próprio componente de
      // ações (ADR-0004); a DATA não. Montar amplo é seguro.
      stageKey: entry.stage_key ?? null,
      stageRole: stageRoleByKey.get(entry.stage_key) ?? null,
      pipelineId,
      meetingDate,
      // ── A reunião no card (S6) ──
      // `date` é a linha de compromisso do card e NENHUM board do repo a
      // preenchia — `parsedDate` era sempre nulo em todo funil. Ela passa a
      // sair da MESMA projeção que o funil mergeado já lia
      // (`metadata.meeting_date`), que é onde o espelho da Agenda grava a
      // reunião marcada. Sem flag de org e sem lista de etapa: a data aparece
      // porque ela existe.
      date: meetingDate,
      confirmationStatus:
        (entry.metadata?.confirmation_status as LeadCardData["confirmationStatus"]) ??
        (entry.is_confirmed ? "confirmado" : "pendente"),
    };
  };

  const columns: KanbanColumn<LeadCardData>[] = useMemo(
    () =>
      stages.map((stage) => {
        const slot = stageData[stage.stage_key];
        const items = ((slot?.items ?? []) as FunilEntry[]).map(transformToCard);
        return {
          // Coluna endereçada por stage_key — a chave que `get_pipeline_page`
          // pagina e que o espelho do banco mantém para as duas famílias.
          id: stage.stage_key,
          title: stage.name,
          color: stage.color || "#64748b",
          items,
          totalCount: slot?.totalCount ?? items.length,
          hasMore: slot?.hasMore ?? false,
          isFetchingMore: slot?.isFetchingMore ?? false,
          onLoadMore: slot?.fetchMore,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages, stageData, metricsMap],
  );

  const findEntry = (entryId: string): FunilEntry | undefined => {
    for (const s of stages) {
      const hit = ((stageData[s.stage_key]?.items ?? []) as FunilEntry[]).find((e) => e.id === entryId);
      if (hit) return hit;
    }
    return undefined;
  };

  return (
    <>
      <DraggableKanbanBoard<LeadCardData>
        columns={columns}
        onStatusChange={(itemId, newStageKey) => {
          const stage = stages.find((s) => s.stage_key === newStageKey);
          if (stage) onMove(itemId, stage);
        }}
        disabled={!canMovePipe}
        onDeleteAllLeads={onDeleteAllLeads}
        onExportStage={(stageKey, stageTitle) => {
          const col = columns.find((c) => c.id === stageKey);
          setStageToExport({ id: stageKey, title: stageTitle, count: col?.items.length ?? 0 });
        }}
        renderColumnExtra={(col) => {
          if (renderStageBadge) return renderStageBadge({ id: col.id, title: col.title });
          const allCounts = workflowCounts["__all__"] || { total: 0, active: 0 };
          const stageCounts = workflowCounts[col.id] || { total: 0, active: 0 };
          const merged = {
            total: stageCounts.total + allCounts.total,
            active: stageCounts.active + allCounts.active,
          };
          return (
            <FunilStageBadge
              pipelineId={pipelineId}
              stageKey={col.id}
              stageName={col.title}
              counts={merged}
            />
          );
        }}
        renderCard={(card) => (
          <LeadCard
            lead={card}
            variant="custom"
            density="compact"
            showValue
            extraActions={
              <MergedFunnelCardActions
                entryId={card.id}
                stageKey={card.stageKey}
                stageRole={card.stageRole}
                meetingDate={card.meetingDate}
                confirmationStatus={card.confirmationStatus}
                lostStageKey={lostStageKey}
                onMoveStage={(toStage) => {
                  const st = stages.find((s) => s.stage_key === toStage);
                  if (st) onMove(card.id, st);
                }}
                leadId={card.leadId}
                leadName={card.name}
                leadCompany={card.company}
                leadPhone={card.phone}
              />
            }
            selected={bulk.isSelected(card.leadId || "")}
            onSelect={(e) => {
              const lid = card.leadId || "";
              if (e.shiftKey) bulk.toggleRange(lid, allLeadIds);
              else bulk.toggle(lid);
            }}
            onClick={() => {
              const entry = findEntry(card.id);
              if (entry) onClickEntry?.(entry);
            }}
            onRemove={onRemoveEntry ? () => onRemoveEntry(card.id) : undefined}
            onQuickAction={(title) => {
              createAcaoDoDia.mutate({ title, lead_id: card.leadId || undefined });
            }}
          />
        )}
      />
      <ExportStageDialog
        open={!!stageToExport}
        onOpenChange={(o) => {
          if (!o) setStageToExport(null);
        }}
        // Modo unificado (SCRUM-633): etapa endereçada por
        // (pipelines.id, pipeline_stages.id) — serve qualquer família.
        stageId={stages.find((s) => s.stage_key === stageToExport?.id)?.id ?? ""}
        stageTitle={stageToExport?.title ?? ""}
        pipelineId={pipelineId}
        leadCount={stageToExport?.count ?? 0}
      />
      {/* SCRUM-611 — o que está marcado aqui são NEGÓCIOS, não pessoas.
          Sem `escopoFunil`, o botão vermelho desta barra mandava a PESSOA para
          a lixeira: ela sumia da lista de Leads, dos outros funis, da carteira
          e do chat — a partir de um clique dado sobre um card de negócio. */}
      <BulkActionBar
        selectedIds={bulk.selectedIds}
        onClear={bulk.clearSelection}
        leadIds={allLeadIds}
        escopoFunil={{ pipelineId }}
        onDisparar={
          onDisparar
            ? (leadIds) => {
                onDisparar(leadIds);
                bulk.clearSelection();
              }
            : undefined
        }
      />
    </>
  );
}
