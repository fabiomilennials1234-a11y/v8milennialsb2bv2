import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useLeadAllPipelines,
  useRemoveLeadFromStandardPipe,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "../../../../hooks/useLeadAllPipelines";
import { usePipeOps } from "../../../../pipe-ops";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { MeetingFieldBlock } from "../../cross-pipe/MeetingFieldBlock";
import { BudgetFieldBlock } from "../../cross-pipe/BudgetFieldBlock";
import { ActionPill, type ActionPillType } from "./ActionPill";
import { ActionPanel } from "./ActionPanel";
import { NewDealDialog } from "./NewDealDialog";
import {
  isCustomPipe,
  isSystemPipe,
} from "./newDealOptions";
import { useAbrirNegocio } from "./useAbrirNegocio";
import { DealMeta } from "./DealMeta";
import { useLeadsDeals } from "../../../../hooks/useLeadsDeals";
import { StageRail, type StageRailPipe } from "./StageRail";
import { useCrossPipeMove } from "./useCrossPipeMove";
import {
  focusStorageKey,
  loadStoredFocus,
  persistFocus,
  pickDefaultExpanded,
  railKey,
} from "./pipeRanking";

/**
 * CrossPipePanel — a seção **Negócios** do lead. Três zonas horizontais:
 *
 *   A. StageRails        — uma linha por negócio (= card de funil), com valor,
 *                          tempo parado e ponte pro board em `DealMeta`
 *   B. ActionPills + Panel — chips de reunião/orçamento + editor expandido
 *   C. NewDealDialog     — a única porta de criação de negócio (decisão D1)
 *
 * Vocabulário: **card de funil É o negócio** enquanto `deals` não está acesa
 * (0 linhas em prod). O backfill 1:1 da fatia 2 só torna literal o que esta
 * seção já mostra — nenhuma mudança visual no dia da migração. Ver
 * `useLeadsDeals` e o doc `08 — Backlog/em-progresso/lead-negocio-separacao-fluxo-e2e`.
 *
 * Goal: collapse the ~200px tall accordion down to ~140-180px in the
 * typical 2-pipe case while keeping every action one click away.
 *
 * localStorage key (per user+lead) stores the currently expanded action
 * pill: `'meeting' | 'budget' | null`. Legacy values (`confirmacao`,
 * `propostas`, custom pipe ids) are migrated transparently on first read.
 */


type ExpandedAction = "meeting" | "budget" | null;

function storageKey(userId: string | null | undefined, leadId: string) {
  return `lead-modal:expanded:${userId ?? "anon"}:${leadId}`;
}

function migrateStoredValue(raw: string | null): ExpandedAction {
  if (!raw) return null;
  if (raw === "meeting" || raw === "budget") return raw;
  if (raw === "confirmacao") return "meeting";
  if (raw === "propostas") return "budget";
  return null;
}

interface CrossPipePanelProps {
  leadId: string;
  organizationId: string;
  defaultExpandedPipeEntryId?: string | null;
  userId?: string | null;
}

export const CrossPipePanel = memo(function CrossPipePanel({
  leadId,
  organizationId: _organizationId,
  defaultExpandedPipeEntryId,
  userId,
}: CrossPipePanelProps) {
  const { usePipeConfirmacaoByLeadId, usePipePropostaByLeadId, useRemoveLeadFromCustomPipe, MergedMeetingEditor } = usePipeOps();
  const { hasFeature } = useOrgFeatures();
  const { data: pipelines = [], isLoading } = useLeadAllPipelines(leadId);
  // Metadados do negócio (valor, tempo parado, funil-alvo) — mesma fonte que a
  // coluna "Negócios" da lista, então as duas telas contam a mesma coisa.
  const { data: dealsByLead } = useLeadsDeals(leadId ? [leadId] : []);
  const { data: confirmacaoData } = usePipeConfirmacaoByLeadId(leadId);
  const { data: propostaData } = usePipePropostaByLeadId(leadId);
  const removeStandardMutation = useRemoveLeadFromStandardPipe();
  const removeCustomMutation = useRemoveLeadFromCustomPipe();
  const logAction = useLogLeadAction();
  const { canAddToPipe, canRemoveFromPipe, canMoveMeeting } = useLeadActionGates(leadId);
  const move = useCrossPipeMove(leadId);

  // ─── Partition pipes ────────────────────────────────────────────────
  const systemPipes = useMemo(
    () => (pipelines as PipelineStatus[]).filter(isSystemPipe),
    [pipelines],
  );
  const customPipes = useMemo(
    () => (pipelines as PipelineStatus[]).filter(isCustomPipe),
    [pipelines],
  );

  const activeSystem = useMemo(
    () => systemPipes.filter((p) => p.pipeId !== null),
    [systemPipes],
  );
  const activeCustom = useMemo(
    () => customPipes.filter((p) => p.entryId !== null),
    [customPipes],
  );

  const hasConfirmacao = activeSystem.some((p) => p.pipeType === "confirmacao");
  const hasPropostas = activeSystem.some((p) => p.pipeType === "propostas");

  // Funil mergeado (ADR-0004): a reunião vive na entry whatsapp
  // num stage de reunião. Habilita o editor de data dentro do modal.
  const whatsappEntry = activeSystem.find((p) => p.pipeType === "whatsapp") as StandardPipelineStatus | undefined;
  const mergedMeeting =
    hasFeature("merged_opportunity_funnel") &&
    !!whatsappEntry?.pipeId &&
    ["agendado", "remarcar", "compareceu", "nao_compareceu"].includes(whatsappEntry?.currentStage ?? "");

  // ─── Expanded action state ──────────────────────────────────────────
  const key = storageKey(userId, leadId);

  const initialExpanded = useMemo<ExpandedAction>(() => {
    if (!hasConfirmacao && !hasPropostas) return null;
    if (typeof window === "undefined") return null;
    const migrated = migrateStoredValue(window.localStorage.getItem(key));
    if (migrated === "meeting" && hasConfirmacao) return "meeting";
    if (migrated === "budget" && hasPropostas) return "budget";

    // Hint via defaultExpandedPipeEntryId
    if (defaultExpandedPipeEntryId) {
      const sysMatch = activeSystem.find((p) => p.pipeId === defaultExpandedPipeEntryId);
      if (sysMatch?.pipeType === "confirmacao") return "meeting";
      if (sysMatch?.pipeType === "propostas") return "budget";
    }
    return null;
  }, [hasConfirmacao, hasPropostas, key, defaultExpandedPipeEntryId, activeSystem]);

  const [expanded, setExpanded] = useState<ExpandedAction>(initialExpanded);

  useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  const persistExpanded = useCallback(
    (next: ExpandedAction) => {
      if (typeof window === "undefined") return;
      if (next) window.localStorage.setItem(key, next);
      else window.localStorage.removeItem(key);
    },
    [key],
  );

  const togglePill = useCallback(
    (type: ActionPillType) => {
      setExpanded((cur) => {
        const next = cur === type ? null : type;
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const forceExpand = useCallback(
    (type: ActionPillType) => {
      setExpanded(type);
      persistExpanded(type);
    },
    [persistExpanded],
  );

  // ─── Build rail descriptors ─────────────────────────────────────────
  const rails: StageRailPipe[] = useMemo(() => {
    const list: StageRailPipe[] = activeSystem.map((p) => ({
      kind: "system" as const,
      recordId: p.pipeId!,
      pipeRef: p.pipeType,
      shortLabel: p.label,
      color: p.color,
      stages: p.stages.map((s) => ({ key: s.id, label: s.label })),
      currentKey: p.currentStage,
    }));
    for (const p of activeCustom) {
      list.push({
        kind: "custom",
        recordId: p.entryId!,
        pipeRef: p.pipelineId,
        shortLabel: p.pipelineName,
        color: p.pipelineColor,
        stages: p.stages.map((s) => ({ key: s.id, label: s.name })),
        currentKey: p.currentStageId,
      });
    }
    return list;
  }, [activeSystem, activeCustom]);

  // `recordId` do rail é o id da `pipeline_entries` (system e custom), a mesma
  // chave que `useLeadsDeals` devolve — casa 1:1 sem tradução.
  const dealByEntryId = useMemo(() => {
    const map = new Map<string, NonNullable<typeof dealsByLead>[string][number]>();
    for (const deal of dealsByLead?.[leadId] ?? []) map.set(deal.id, deal);
    return map;
  }, [dealsByLead, leadId]);

  // ─── Rail focus (which rail is expanded) ───────────────────────────
  // Single-expand: at most one rail is expanded at a time. When 2+ rails
  // are active, the others render as compact chips. Persisted per user+lead
  // in localStorage with a fallback heuristic (most-advanced system pipe).
  const railFocusKey = focusStorageKey(userId, leadId);

  const initialRailFocus = useMemo<string | null>(() => {
    if (rails.length === 0) return null;
    const stored = loadStoredFocus(railFocusKey, rails);
    return stored ?? pickDefaultExpanded(rails);
  }, [rails, railFocusKey]);

  const [expandedRailKey, setExpandedRailKey] = useState<string | null>(
    initialRailFocus,
  );

  // Re-sync when rails change (lead added/removed from a pipe, or modal
  // reopens for a different lead). Also handles the storage-points-to-
  // removed-pipe case: pickDefaultExpanded never returns a removed key.
  useEffect(() => {
    setExpandedRailKey((current) => {
      if (rails.length === 0) return null;
      const stillValid =
        current && rails.some((r) => railKey(r) === current);
      if (stillValid) return current;
      const stored = loadStoredFocus(railFocusKey, rails);
      return stored ?? pickDefaultExpanded(rails);
    });
  }, [rails, railFocusKey]);

  const handleExpandRail = useCallback(
    (target: StageRailPipe) => {
      const next = railKey(target);
      setExpandedRailKey(next);
      persistFocus(railFocusKey, next);
    },
    [railFocusKey],
  );

  // ─── Abrir negócio — a porta única (ADR-0023 decisão 3) ────────────
  //
  // O construtor de opções e o roteamento saíram daqui para `newDealOptions`/
  // `useAbrirNegocio` porque o botão "Criar negócio" do Card do Lead precisa
  // exatamente do mesmo comportamento — e a alternativa era uma segunda cópia
  // da regra, que é como duas telas passam a discordar sobre onde a Carteira
  // está travada. O painel só acrescenta o que é dele: abrir o editor certo
  // logo depois de criar.
  const {
    options: dealOptions,
    isCreating,
    criar: handleCreateDeal,
  } = useAbrirNegocio({
    leadId,
    organizationId: _organizationId,
    pipelines: pipelines as PipelineStatus[],
    canAdd: canAddToPipe,
    vendaFechada: propostaData?.status === "vendido",
    onCreated: (option) => {
      if (option.key === "sys:confirmacao") forceExpand("meeting");
      else if (option.key === "sys:propostas") forceExpand("budget");
    },
  });

  // ─── Remove handlers ───────────────────────────────────────────────
  const handleRemoveSystem = useCallback(
    async (pipe: StandardPipelineStatus) => {
      if (!pipe.pipeId) return;
      try {
        await removeStandardMutation.mutateAsync({
          pipeId: pipe.pipeId,
          pipeType: pipe.pipeType,
        });
        void logAction({
          leadId,
          action: "pipe_removed",
          description: `Removido de ${pipe.label}`,
          metadata: {
            pipe_type: pipe.pipeType,
            entry_id: pipe.pipeId,
            stage_at_removal: pipe.currentStage,
          },
        });
        toast.success(`Removido de ${pipe.label}`);
        if (pipe.pipeType === "confirmacao" && expanded === "meeting") {
          setExpanded(null);
          persistExpanded(null);
        }
        if (pipe.pipeType === "propostas" && expanded === "budget") {
          setExpanded(null);
          persistExpanded(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao remover";
        toast.error(msg);
      }
    },
    [removeStandardMutation, leadId, logAction, expanded, persistExpanded],
  );

  // ─── Loading ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="cross-pipe-panel-loading">
        <div className="h-9 rounded-lg bg-muted/30 motion-safe:animate-pulse" />
        <div className="h-9 rounded-lg bg-muted/30 motion-safe:animate-pulse" />
        <div className="h-9 rounded-lg bg-muted/30 motion-safe:animate-pulse" />
      </div>
    );
  }

  // ─── Sem negócio ────────────────────────────────────────────────────
  // O lead existe, ninguém abriu negócio ainda. Depois do D1 este é o estado
  // normal de entrada — o ingest cria lead e para por aí —, então o vazio
  // precisa oferecer a ação, não só informar a ausência.
  if (rails.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed border-border/40 bg-muted/10 p-6 text-center"
        data-testid="cross-pipe-panel-empty"
      >
        <Layers className="w-6 h-6 mx-auto text-muted-foreground/60 mb-2" />
        <p className="text-sm text-muted-foreground">Nenhum negócio ainda</p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">
          O lead está na base. Abrir um negócio é o que o coloca num funil.
        </p>
        <div className="mt-3 flex justify-center">
          <NewDealDialog
            options={dealOptions}
            isCreating={isCreating}
            onCreate={handleCreateDeal}
            size="md"
          />
        </div>
      </div>
    );
  }

  const movePipeDisabledReason = !canMoveMeeting.allowed
    ? canMoveMeeting.reason ?? "Sem permissão"
    : undefined;

  const confirmacaoEntry = activeSystem.find((p) => p.pipeType === "confirmacao");
  const propostasEntry = activeSystem.find((p) => p.pipeType === "propostas");

  return (
    <div className={cn("space-y-3")} data-testid="cross-pipe-panel">
      {/* Cabeçalho — conta os negócios e carrega a única porta de criação. */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Negócios
          <span className="text-[11px] tabular-nums text-muted-foreground/60">
            {rails.length}
          </span>
        </h3>
        <NewDealDialog
          options={dealOptions}
          isCreating={isCreating}
          onCreate={handleCreateDeal}
        />
      </div>

      {/* Zone A — StageRails (single-expand, collapsed chips for others) */}
      {rails.length > 0 && (
        <div
          className="space-y-1.5"
          data-testid="stage-rails"
          role="region"
          aria-label="Negócios do lead"
        >
          {rails.map((rail) => {
            const key = railKey(rail);
            const isExpanded = key === expandedRailKey;
            return (
              <div key={key} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <StageRail
                    pipe={rail}
                    pendingStageKey={move.pendingStageKey}
                    recentlyMovedStageKey={move.recentlyMovedStageKey}
                    disabled={!canMoveMeeting.allowed}
                    disabledReason={movePipeDisabledReason}
                    onMove={move.move}
                    mode={isExpanded ? "expanded" : "collapsed"}
                    onExpand={() => handleExpandRail(rail)}
                  />
                </div>
                <DealMeta
                  deal={dealByEntryId.get(rail.recordId)}
                  fallbackLabel={rail.shortLabel}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Zone B — Action pills + panel */}
      {(hasConfirmacao || hasPropostas || mergedMeeting) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap" data-testid="action-pills-row">
            {(hasConfirmacao || mergedMeeting) && (
              <ActionPill
                type="meeting"
                value={confirmacaoData?.meeting_date ?? null}
                isOpen={expanded === "meeting"}
                onToggle={() => togglePill("meeting")}
              />
            )}
            {hasPropostas && (
              <ActionPill
                type="budget"
                value={propostaData?.sale_value ?? null}
                isOpen={expanded === "budget"}
                onToggle={() => togglePill("budget")}
              />
            )}
          </div>

          {/* Merge ON: edita a reunião na entry whatsapp (+ cria evento no Calendar). */}
          {expanded === "meeting" && mergedMeeting && whatsappEntry?.pipeId && (
            <ActionPanel pipeLabel="Reunião" canRemove={false} onRemove={() => {}} isRemoving={false}>
              <MergedMeetingEditor
                entryId={whatsappEntry.pipeId}
                leadId={leadId}
                currentMeetingDate={null}
                locked={!canMoveMeeting.allowed}
              />
            </ActionPanel>
          )}
          {expanded === "meeting" && !mergedMeeting && confirmacaoEntry && (
            <ActionPanel
              pipeLabel={confirmacaoEntry.label}
              canRemove={canRemoveFromPipe.allowed}
              onRemove={() => handleRemoveSystem(confirmacaoEntry)}
              isRemoving={removeStandardMutation.isPending}
            >
              <MeetingFieldBlock
                leadId={leadId}
                organizationId={_organizationId}
                pipeData={confirmacaoData ?? null}
                locked={!canMoveMeeting.allowed}
                bare
              />
            </ActionPanel>
          )}
          {expanded === "budget" && propostasEntry && (
            <ActionPanel
              pipeLabel={propostasEntry.label}
              canRemove={canRemoveFromPipe.allowed}
              onRemove={() => handleRemoveSystem(propostasEntry)}
              isRemoving={removeStandardMutation.isPending}
            >
              <BudgetFieldBlock
                leadId={leadId}
                organizationId={_organizationId}
                pipeData={propostaData ?? null}
                locked={!canMoveMeeting.allowed}
                bare
              />
            </ActionPanel>
          )}
        </div>
      )}

      {/* Zone C — a criação mora no cabeçalho (`NewDealDialog`). O strip de
          chips pontilhados saiu junto com `OtherPipesStrip`/`InactivePipeChip`:
          com negócio nascendo só de clique, "adicionar a um pipe" virou a ação
          principal e não podia seguir como rodapé de um clique só, sem etapa,
          sem dono e sem valor. */}

      {/* Hidden but accessible: custom pipe remove via kebab is handled by
          ActionPanel which today only renders for confirmação/propostas.
          Custom pipe remove is intentionally not in scope here — admins do it
          from the dedicated custom-pipeline screen. */}
      {/* Silences unused-variable lints when custom remove is wired later. */}
      <span hidden aria-hidden>
        {String(removeCustomMutation.isPending)}
      </span>
    </div>
  );
});
