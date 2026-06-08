import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useAddLeadToStandardPipe,
  useLeadAllPipelines,
  useRemoveLeadFromStandardPipe,
  type CustomPipelineStatus,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "../../../../hooks/useLeadAllPipelines";
import { usePipeOps } from "../../../../pipe-ops";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useLogLeadAction } from "../../../../hooks/useLogLeadAction";
import { useLeadActionGates } from "../../hooks/useLeadActionGates";
import { MeetingFieldBlock } from "../../cross-pipe/MeetingFieldBlock";
import { BudgetFieldBlock } from "../../cross-pipe/BudgetFieldBlock";
import { ActionPill, type ActionPillType } from "./ActionPill";
import { ActionPanel } from "./ActionPanel";
import { OtherPipesStrip, type InactivePipeDescriptor } from "./OtherPipesStrip";
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
 * CrossPipePanel — replaces LeadCrossPipeAccordion. Three horizontal zones:
 *
 *   A. StageRails        — one row per pipe the lead is currently in
 *   B. ActionPills + Panel — meeting/budget summary chips + expanded editor
 *   C. OtherPipesStrip   — dashed chips for pipes the lead is *not* in
 *
 * Goal: collapse the ~200px tall accordion down to ~140-180px in the
 * typical 2-pipe case while keeping every action one click away.
 *
 * localStorage key (per user+lead) stores the currently expanded action
 * pill: `'meeting' | 'budget' | null`. Legacy values (`confirmacao`,
 * `propostas`, custom pipe ids) are migrated transparently on first read.
 */

const SYSTEM_PIPE_TYPES = new Set<StandardPipelineStatus["pipeType"]>([
  "qualificacao",
  "confirmacao",
  "propostas",
]);

const SYSTEM_RAIL_REF: Record<string, "whatsapp" | "confirmacao" | "propostas"> = {
  qualificacao: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

const SYSTEM_PIPE_SHORT_LABEL: Record<string, string> = {
  qualificacao: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell: "Carteira",
};

function isSystemPipe(p: PipelineStatus): p is StandardPipelineStatus & {
  pipeType: "qualificacao" | "confirmacao" | "propostas";
} {
  return p.type === "standard" && SYSTEM_PIPE_TYPES.has(p.pipeType);
}

function isUpsellPipe(p: PipelineStatus): p is StandardPipelineStatus {
  return p.type === "standard" && p.pipeType === "upsell";
}

function isCustomPipe(p: PipelineStatus): p is CustomPipelineStatus {
  return p.type === "custom";
}

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
  const { usePipeConfirmacaoByLeadId, usePipePropostaByLeadId, useAddLeadToCustomPipe, useRemoveLeadFromCustomPipe, MergedMeetingEditor } = usePipeOps();
  const { hasFeature } = useOrgFeatures();
  const { data: pipelines = [], isLoading } = useLeadAllPipelines(leadId);
  const { data: confirmacaoData } = usePipeConfirmacaoByLeadId(leadId);
  const { data: propostaData } = usePipePropostaByLeadId(leadId);
  const addStandardMutation = useAddLeadToStandardPipe();
  const removeStandardMutation = useRemoveLeadFromStandardPipe();
  const addCustomMutation = useAddLeadToCustomPipe();
  const removeCustomMutation = useRemoveLeadFromCustomPipe();
  const logAction = useLogLeadAction();
  const { canAddToPipe, canRemoveFromPipe, canMoveMeeting } = useLeadActionGates(leadId);
  const move = useCrossPipeMove(leadId);

  // ─── Partition pipes ────────────────────────────────────────────────
  const systemPipes = useMemo(
    () => (pipelines as PipelineStatus[]).filter(isSystemPipe),
    [pipelines],
  );
  const upsellPipe = useMemo(
    () => (pipelines as PipelineStatus[]).find(isUpsellPipe) ?? null,
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
  const inactiveSystem = useMemo(
    () => systemPipes.filter((p) => p.pipeId === null),
    [systemPipes],
  );
  const activeCustom = useMemo(
    () => customPipes.filter((p) => p.entryId !== null),
    [customPipes],
  );
  const inactiveCustom = useMemo(
    () => customPipes.filter((p) => p.entryId === null),
    [customPipes],
  );

  const upsellActive = !!upsellPipe?.pipeId;

  const hasConfirmacao = activeSystem.some((p) => p.pipeType === "confirmacao");
  const hasPropostas = activeSystem.some((p) => p.pipeType === "propostas");

  // Funil mergeado (ADR-0004): a reunião vive na entry whatsapp (qualificacao)
  // num stage de reunião. Habilita o editor de data dentro do modal.
  const whatsappEntry = activeSystem.find((p) => p.pipeType === "qualificacao") as StandardPipelineStatus | undefined;
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
      pipeRef: SYSTEM_RAIL_REF[p.pipeType],
      shortLabel: SYSTEM_PIPE_SHORT_LABEL[p.pipeType] ?? p.label,
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

  // ─── Add handlers ──────────────────────────────────────────────────
  const handleAddSystem = useCallback(
    async (pipe: StandardPipelineStatus) => {
      if (!pipe.stages.length) {
        toast.error("Pipe sem stages configuradas");
        return;
      }
      const stageId = pipe.stages[0].id;
      try {
        await addStandardMutation.mutateAsync({
          leadId,
          pipeType: pipe.pipeType,
          stageId,
        });
        void logAction({
          leadId,
          action: "pipe_added",
          description: `Adicionado a ${pipe.label}`,
          metadata: { pipe_type: pipe.pipeType, stage_key: stageId },
        });
        toast.success(`Adicionado a ${pipe.label}`);
        if (pipe.pipeType === "confirmacao") forceExpand("meeting");
        else if (pipe.pipeType === "propostas") forceExpand("budget");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao adicionar";
        toast.error(msg);
      }
    },
    [addStandardMutation, leadId, logAction, forceExpand],
  );

  const handleAddCustom = useCallback(
    async (pipe: CustomPipelineStatus) => {
      if (!pipe.stages.length) {
        toast.error("Pipe sem stages configuradas");
        return;
      }
      const stageId = pipe.stages[0].id;
      try {
        await addCustomMutation.mutateAsync({
          lead_id: leadId,
          pipeline_id: pipe.pipelineId,
          stage_id: stageId,
        });
        void logAction({
          leadId,
          action: "pipe_added",
          description: `Adicionado a ${pipe.pipelineName}`,
          metadata: {
            pipe_type: "custom",
            pipeline_id: pipe.pipelineId,
            stage_id: stageId,
          },
        });
        toast.success(`Adicionado a ${pipe.pipelineName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao adicionar";
        toast.error(msg);
      }
    },
    [addCustomMutation, leadId, logAction],
  );

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

  // ─── Inactive descriptors for strip ────────────────────────────────
  const inactive: InactivePipeDescriptor[] = useMemo(() => {
    const out: InactivePipeDescriptor[] = [];
    for (const p of inactiveSystem) {
      out.push({
        key: `sys:${p.pipeType}`,
        label: p.label,
        shortLabel: SYSTEM_PIPE_SHORT_LABEL[p.pipeType] ?? p.label,
        isAdding: addStandardMutation.isPending,
        onAdd: () => handleAddSystem(p),
        disabled: !canAddToPipe.allowed,
        disabledReason: canAddToPipe.reason ?? "Sem permissão",
        testId: `inactive-pipe-chip-sys-${p.pipeType}`,
      });
    }
    if (upsellPipe && !upsellActive) {
      const hasClosedSale = propostaData?.status === "vendido";
      out.push({
        key: "sys:upsell",
        label: upsellPipe.label,
        shortLabel: SYSTEM_PIPE_SHORT_LABEL.upsell,
        isAdding: addStandardMutation.isPending,
        onAdd: () => handleAddSystem(upsellPipe),
        disabled: !canAddToPipe.allowed || !hasClosedSale,
        disabledReason: !canAddToPipe.allowed
          ? canAddToPipe.reason ?? "Sem permissão"
          : !hasClosedSale
            ? "Disponível só quando há venda fechada"
            : undefined,
        testId: "inactive-pipe-chip-sys-upsell",
      });
    }
    const sortedCustoms = [...inactiveCustom].sort((a, b) =>
      a.pipelineName.localeCompare(b.pipelineName, "pt-BR"),
    );
    for (const p of sortedCustoms) {
      out.push({
        key: `custom:${p.pipelineId}`,
        label: p.pipelineName,
        shortLabel: p.pipelineName,
        isAdding: addCustomMutation.isPending,
        onAdd: () => handleAddCustom(p),
        disabled: !canAddToPipe.allowed,
        disabledReason: canAddToPipe.reason ?? "Sem permissão",
        testId: `inactive-pipe-chip-custom-${p.pipelineId}`,
      });
    }
    return out;
  }, [
    inactiveSystem,
    inactiveCustom,
    upsellPipe,
    upsellActive,
    propostaData?.status,
    addStandardMutation.isPending,
    addCustomMutation.isPending,
    canAddToPipe.allowed,
    canAddToPipe.reason,
    handleAddSystem,
    handleAddCustom,
  ]);

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

  // ─── Total empty (no active, no inactive) ──────────────────────────
  if (rails.length === 0 && inactive.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed border-border/40 bg-muted/10 p-6 text-center"
        data-testid="cross-pipe-panel-empty"
      >
        <Layers className="w-6 h-6 mx-auto text-muted-foreground/60 mb-2" />
        <p className="text-sm text-muted-foreground">Sem pipes ainda</p>
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
      {/* Zone A — StageRails (single-expand, collapsed chips for others) */}
      {rails.length > 0 && (
        <div
          className="space-y-1.5"
          data-testid="stage-rails"
          role="region"
          aria-label="Pipes do lead"
        >
          {rails.map((rail) => {
            const key = railKey(rail);
            const isExpanded = key === expandedRailKey;
            return (
              <StageRail
                key={key}
                pipe={rail}
                pendingStageKey={move.pendingStageKey}
                recentlyMovedStageKey={move.recentlyMovedStageKey}
                disabled={!canMoveMeeting.allowed}
                disabledReason={movePipeDisabledReason}
                onMove={move.move}
                mode={isExpanded ? "expanded" : "collapsed"}
                onExpand={() => handleExpandRail(rail)}
              />
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

      {/* Zone C — Other pipes strip */}
      {inactive.length > 0 && <OtherPipesStrip inactive={inactive} />}

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
