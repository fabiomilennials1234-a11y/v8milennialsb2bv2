import { memo, useMemo, useState } from "react";
import { X, ArrowUpRight, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { useDealSheet } from "./deal-sheet-context";
import { useLeadDetail } from "../lead-detail/hooks/useLeadDetail";
import { useLeadDetailRealtime } from "../lead-detail/hooks/useLeadDetailRealtime";
import { useLeadActionGates } from "../lead-detail/hooks/useLeadActionGates";
import { LeadActivityColumn } from "../lead-detail/modal/activity/LeadActivityColumn";
import { LeadModalSkeleton } from "../lead-detail/modal/LeadModalSkeleton";
import { StageRail, type StageRailPipe } from "../lead-detail/modal/pipes/StageRail";
import { ActionPill, type ActionPillType } from "../lead-detail/modal/pipes/ActionPill";
import { ActionPanel } from "../lead-detail/modal/pipes/ActionPanel";
import { useCrossPipeMove } from "../lead-detail/modal/pipes/useCrossPipeMove";
import { MeetingFieldBlock } from "../lead-detail/cross-pipe/MeetingFieldBlock";
import { BudgetFieldBlock } from "../lead-detail/cross-pipe/BudgetFieldBlock";
import { usePipeOps } from "../../pipe-ops";
import {
  useLeadAllPipelines,
  useRemoveLeadFromStandardPipe,
  type CustomPipelineStatus,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "../../hooks/useLeadAllPipelines";
import { useLeadsDeals } from "../../hooks/useLeadsDeals";

/**
 * Modal do **negócio** — o que o card do funil abre.
 *
 * O modal do lead (`LeadDetailDialog`) passou a abrir só na aba Leads. Aqui o
 * sujeito é o negócio: uma etapa, um valor, uma reunião. A identidade da pessoa
 * aparece como cabeçalho (herança por referência, D2) e "Ver lead ↗" leva pra
 * ficha completa.
 *
 * A coluna de atividade é a **mesma** do modal do lead, de propósito: a conversa
 * do WhatsApp é uma linha do tempo por pessoa (decisão D5a), não por negócio.
 * Tirar isso do funil custaria ao vendedor a tela onde ele trabalha o dia todo.
 */

const SYSTEM_SHORT_LABEL: Record<string, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
  upsell: "Carteira",
};

/** Etapas em que o funil mergeado (ADR-0004) guarda a reunião na entry whatsapp. */
const MERGED_MEETING_STAGES = ["agendado", "remarcar", "compareceu", "nao_compareceu"];

/**
 * Recursos que o negócio expõe como *action pill*.
 *
 * **Esta função é a costura** para a proposta de "recursos por funil" do
 * protótipo `.specs/mockups/funis-redesign/` — quando existir configuração por
 * funil, ela passa a ler dali em vez de deduzir do tipo do pipe. A mecânica
 * pill → painel já é a definitiva; só a origem da lista muda.
 *
 * Hoje a lista sai do que o banco **consegue guardar**, não do que seria bonito
 * oferecer:
 * - `confirmacao` → reunião (`pipe_confirmacao.meeting_date`)
 * - `propostas` → orçamento (`pipe_propostas.sale_value` + itens)
 * - `whatsapp` com funil mergeado (ADR-0004) → reunião mora na entry whatsapp
 * - **custom → nada.** `custom_pipe_entries` não tem `metadata jsonb`, e
 *   `pipe_proposta_items.pipe_proposta_id` referencia `pipeline_entries(id)` —
 *   outro espaço de ids. Não é escolha de design, é trava de schema; ligar pill
 *   aqui daria campo que salva no vazio. Levantamento do protótipo, itens 1 e 2.
 */
function dealPills(pipe: PipelineStatus, mergedMeeting: boolean): ActionPillType[] {
  if (!isStandard(pipe)) return [];
  if (pipe.pipeType === "confirmacao") return ["meeting"];
  if (pipe.pipeType === "propostas") return ["budget"];
  if (pipe.pipeType === "whatsapp" && mergedMeeting) return ["meeting"];
  return [];
}

function isStandard(p: PipelineStatus): p is StandardPipelineStatus {
  return p.type === "standard";
}

function isCustom(p: PipelineStatus): p is CustomPipelineStatus {
  return p.type === "custom";
}

function DealContent({ onClose, isMobile }: { onClose: () => void; isMobile: boolean }) {
  const { entryId, leadId } = useDealSheet();
  const { lead, isLoading, visibility } = useLeadDetail(leadId, true);
  useLeadDetailRealtime(leadId, true, lead?.organization_id ?? null);

  const { usePipeConfirmacaoByLeadId, usePipePropostaByLeadId, MergedMeetingEditor } = usePipeOps();
  const { hasFeature } = useOrgFeatures();
  const { data: pipelines = [], isLoading: pipesLoading } = useLeadAllPipelines(leadId);
  const { data: dealsByLead } = useLeadsDeals(leadId ? [leadId] : []);
  const { data: confirmacaoData } = usePipeConfirmacaoByLeadId(leadId ?? "");
  const { data: propostaData } = usePipePropostaByLeadId(leadId ?? "");
  const { canMoveMeeting, canRemoveFromPipe } = useLeadActionGates(leadId ?? "");
  const move = useCrossPipeMove(leadId ?? "");
  const removeStandard = useRemoveLeadFromStandardPipe();

  /**
   * `null` = ninguém tocou → abre a primeira pill. `"none"` = fechado de
   * propósito. Derivar em vez de sincronizar por efeito evita o formulário se
   * reabrindo sozinho quando qualquer dependência troca de identidade.
   */
  const [pillChoice, setPillChoice] = useState<ActionPillType | "none" | null>(null);

  /** O pipe a que esta entry pertence — system e custom guardam o id em campos distintos. */
  const pipe = useMemo(() => {
    if (!entryId) return null;
    return (
      (pipelines as PipelineStatus[]).find((p) =>
        isStandard(p) ? p.pipeId === entryId : isCustom(p) ? p.entryId === entryId : false,
      ) ?? null
    );
  }, [pipelines, entryId]);

  const deal = useMemo(
    () => (dealsByLead?.[leadId ?? ""] ?? []).find((d) => d.id === entryId) ?? null,
    [dealsByLead, leadId, entryId],
  );

  const rail: StageRailPipe | null = useMemo(() => {
    if (!pipe || !entryId) return null;
    if (isStandard(pipe)) {
      return {
        kind: "system",
        recordId: entryId,
        pipeRef: pipe.pipeType,
        shortLabel: SYSTEM_SHORT_LABEL[pipe.pipeType] ?? pipe.label,
        color: pipe.color,
        stages: pipe.stages.map((s) => ({ key: s.id, label: s.label })),
        currentKey: pipe.currentStage,
      };
    }
    return {
      kind: "custom",
      recordId: entryId,
      pipeRef: pipe.pipelineId,
      shortLabel: pipe.pipelineName,
      color: pipe.pipelineColor,
      stages: pipe.stages.map((s) => ({ key: s.id, label: s.name })),
      currentKey: pipe.currentStageId,
    };
  }, [pipe, entryId]);

  const closeButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClose}
      className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full hover:bg-muted"
      aria-label="Fechar"
    >
      <X className="h-4 w-4" />
    </Button>
  );

  if (isLoading || pipesLoading) return <LeadModalSkeleton />;

  // Negócio que sumiu embaixo do usuário (removido do funil noutra aba, ou lead
  // apagado). Estado explícito em vez de modal vazio.
  if (visibility !== "exists" || !lead || !pipe || !rail) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        {closeButton}
        <Layers className="size-6 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">Este negócio não está mais disponível</p>
        <p className="text-[12px] text-muted-foreground/70">
          Ele pode ter sido removido do funil por outra pessoa.
        </p>
      </div>
    );
  }

  const organizationId = lead.organization_id ?? "";
  const mergedMeeting =
    isStandard(pipe) &&
    pipe.pipeType === "whatsapp" &&
    hasFeature("merged_opportunity_funnel") &&
    MERGED_MEETING_STAGES.includes(pipe.currentStage ?? "");

  const pills = dealPills(pipe, mergedMeeting);
  const activePill: ActionPillType | null =
    pillChoice === null ? pills[0] ?? null : pillChoice === "none" ? null : pillChoice;

  const pillValue = (type: ActionPillType) =>
    type === "meeting"
      ? confirmacaoData?.meeting_date ?? deal?.meetingDate ?? null
      : propostaData?.sale_value ?? (deal?.value || null);

  /** Remover o negócio = tirar o card do funil. Só funil system tem a mutation. */
  const handleRemove = async () => {
    if (!isStandard(pipe) || !pipe.pipeId) return;
    await removeStandard.mutateAsync({ pipeId: pipe.pipeId, pipeType: pipe.pipeType });
    onClose();
  };

  const dealPane = (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div
        className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
        data-testid="deal-stage-rail"
      >
        <StageRail
          pipe={rail}
          pendingStageKey={move.pendingStageKey}
          recentlyMovedStageKey={move.recentlyMovedStageKey}
          disabled={!canMoveMeeting.allowed}
          disabledReason={canMoveMeeting.reason ?? "Sem permissão"}
          onMove={move.move}
          mode="expanded"
        />
      </div>

      {/* Valor só aparece aqui quando NÃO há pill de orçamento — dois números
          do mesmo dinheiro na mesma tela é como eles passam a divergir. */}
      {deal && ((deal.value > 0 && !pills.includes("budget")) || deal.daysInStage != null) && (
        <div className="flex items-center gap-5 px-1">
          {deal.value > 0 && !pills.includes("budget") && (
            <div className="flex flex-col">
              <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
                Valor
              </span>
              <span
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  deal.outcome === "won" && "text-success",
                )}
              >
                {formatBRL(deal.value)}
              </span>
            </div>
          )}
          {deal.daysInStage != null && (
            <div className="flex flex-col">
              <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
                Nesta etapa
              </span>
              <span
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  deal.daysInStage >= 14 && "text-amber-500",
                )}
              >
                {deal.daysInStage}d
              </span>
            </div>
          )}
        </div>
      )}

      {pills.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2" data-testid="deal-action-pills">
            {pills.map((type) => (
              <ActionPill
                key={type}
                type={type}
                value={pillValue(type)}
                isOpen={activePill === type}
                onToggle={() => setPillChoice(activePill === type ? "none" : type)}
              />
            ))}
          </div>

          {activePill && (
            <ActionPanel
              pipeLabel={rail.shortLabel}
              canRemove={canRemoveFromPipe.allowed && isStandard(pipe)}
              onRemove={handleRemove}
              isRemoving={removeStandard.isPending}
            >
              {activePill === "meeting" && mergedMeeting && entryId ? (
                <MergedMeetingEditor
                  entryId={entryId}
                  leadId={lead.id}
                  currentMeetingDate={null}
                  locked={!canMoveMeeting.allowed}
                />
              ) : activePill === "meeting" ? (
                <MeetingFieldBlock
                  leadId={lead.id}
                  organizationId={organizationId}
                  pipeData={confirmacaoData ?? null}
                  locked={!canMoveMeeting.allowed}
                  bare
                />
              ) : (
                <BudgetFieldBlock
                  leadId={lead.id}
                  organizationId={organizationId}
                  pipeData={propostaData ?? null}
                  locked={!canMoveMeeting.allowed}
                  bare
                />
              )}
            </ActionPanel>
          )}
        </div>
      )}
    </div>
  );

  const header = (
    <div className="relative border-b border-border/60 px-6 py-4">
      {closeButton}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-10">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{lead.name}</h2>
        {lead.company && (
          <span className="text-[14px] text-muted-foreground">· {lead.company}</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className="size-1.5 rounded-full"
          style={{ background: rail.color }}
          aria-hidden
        />
        <span className="text-[12px] text-muted-foreground">
          {rail.shortLabel} · {deal?.stageName ?? "sem etapa"}
        </span>
        <Link
          to={`/leads?lead=${lead.id}`}
          onClick={onClose}
          data-testid="deal-open-lead"
          className={cn(
            "ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5",
            "text-[11.5px] font-medium text-muted-foreground/80",
            "hover:bg-muted/60 hover:text-foreground transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Ver lead
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <Tabs defaultValue="negocio" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-3 mt-2 grid grid-cols-2">
            <TabsTrigger value="negocio">Negócio</TabsTrigger>
            <TabsTrigger value="atividade">Atividade</TabsTrigger>
          </TabsList>
          <TabsContent value="negocio" className="m-0 min-h-0 flex-1 overflow-y-auto">
            {dealPane}
          </TabsContent>
          <TabsContent value="atividade" className="m-0 flex min-h-0 flex-1 flex-col">
            <LeadActivityColumn leadId={lead.id} organizationId={organizationId} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-12">
        <div className="col-span-7 min-h-0 overflow-y-auto">{dealPane}</div>
        <div className="col-span-5 min-h-0 overflow-y-auto">
          <LeadActivityColumn leadId={lead.id} organizationId={organizationId} />
        </div>
      </div>
    </div>
  );
}

export const DealDetailDialog = memo(function DealDetailDialog() {
  const { isOpen, close } = useDealSheet();
  const { isMobile } = useViewport();

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          className="flex h-[90vh] flex-col overflow-hidden rounded-t-2xl p-0"
          aria-describedby={undefined}
        >
          <DealContent onClose={close} isMobile />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="deal-detail-dialog"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
            "w-[min(1180px,calc(100vw-32px))] h-[min(820px,calc(100vh-32px))]",
            "overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Detalhes do negócio</DialogPrimitive.Title>
          <DealContent onClose={close} isMobile={false} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});
