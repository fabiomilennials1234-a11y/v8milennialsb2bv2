import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useLeadAllPipelines,
  type PipelineStatus,
  type StandardPipelineStatus,
} from "@/hooks/useLeadAllPipelines";
import { usePipeConfirmacaoByLeadId } from "@/hooks/usePipeConfirmacaoByLeadId";
import { usePipePropostaByLeadId } from "@/hooks/usePipePropostaByLeadId";
import { MeetingFieldBlock } from "../../cross-pipe/MeetingFieldBlock";
import { BudgetFieldBlock } from "../../cross-pipe/BudgetFieldBlock";
import { MoveStageButton } from "../header/MoveStageButton";

/**
 * Lead-centric accordion of the three system pipes (Qualificação,
 * Confirmação, Propostas). Single-expand: only one section open at a time.
 * Persists the last expanded section per user+lead in localStorage so the
 * modal reopens to the same context.
 *
 * Terminal propostas stages (vendido, perdido) stay collapsed unless the
 * user explicitly opens them — they are not the work surface anymore.
 *
 * Custom pipes and Carteira/Upsell are out of scope for this slice and live
 * in follow-up issues (PRD #284, Fase 4+).
 */

const SYSTEM_PIPE_TYPES = new Set(["qualificacao", "confirmacao", "propostas"]);
const TERMINAL_PROPOSTA_STAGES = new Set(["vendido", "perdido"]);

type SystemPipe = StandardPipelineStatus & {
  pipeType: "qualificacao" | "confirmacao" | "propostas";
};

function isSystemPipe(p: PipelineStatus): p is SystemPipe {
  return p.type === "standard" && SYSTEM_PIPE_TYPES.has(p.pipeType);
}

function isTerminated(pipe: SystemPipe): boolean {
  if (pipe.pipeType !== "propostas") return false;
  return pipe.currentStage ? TERMINAL_PROPOSTA_STAGES.has(pipe.currentStage) : false;
}

function storageKey(userId: string | null | undefined, leadId: string) {
  return `lead-modal:expanded:${userId ?? "anon"}:${leadId}`;
}

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(v);

function meetingUrgency(date: Date | null): { label: string; tone: string } | null {
  if (!date) return null;
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  if (diffMs < -dayMs) return { label: "Atrasada", tone: "bg-red-500/15 text-red-500 border-red-500/30" };
  if (diffMs < 0) return { label: "Hoje", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" };
  const diffDays = Math.ceil(diffMs / dayMs);
  if (diffDays <= 1) return { label: "Hoje", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" };
  if (diffDays === 2) return { label: "Amanhã", tone: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" };
  return { label: `Em ${diffDays} dias`, tone: "bg-muted text-muted-foreground border-border" };
}

interface LeadCrossPipeAccordionProps {
  leadId: string;
  organizationId: string;
  defaultExpandedPipeEntryId?: string | null;
  userId?: string | null;
}

export const LeadCrossPipeAccordion = memo(function LeadCrossPipeAccordion({
  leadId,
  organizationId,
  defaultExpandedPipeEntryId,
  userId,
}: LeadCrossPipeAccordionProps) {
  const { data: pipelines = [], isLoading } = useLeadAllPipelines(leadId);
  const { data: confirmacaoData } = usePipeConfirmacaoByLeadId(leadId);
  const { data: propostaData } = usePipePropostaByLeadId(leadId);

  const systemPipes = useMemo(
    () => (pipelines as PipelineStatus[]).filter(isSystemPipe),
    [pipelines],
  );

  const key = storageKey(userId, leadId);

  const initialExpanded = useMemo<string | null>(() => {
    if (systemPipes.length === 0) return null;

    // 1. localStorage wins
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(key);
      if (stored && systemPipes.some((p) => p.pipeType === stored)) return stored;
    }

    // 2. defaultExpandedPipeEntryId hint
    if (defaultExpandedPipeEntryId) {
      const match = systemPipes.find((p) => p.pipeId === defaultExpandedPipeEntryId);
      if (match) return match.pipeType;
    }

    // 3. first non-terminal
    const firstActive = systemPipes.find((p) => !isTerminated(p));
    return firstActive ? firstActive.pipeType : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPipes, defaultExpandedPipeEntryId, key]);

  const [expanded, setExpanded] = useState<string | null>(initialExpanded);

  // Re-sync when pipes/key change (e.g. switching leads in same modal).
  useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  const toggle = useCallback(
    (pipeType: string) => {
      setExpanded((cur) => {
        const next = cur === pipeType ? null : pipeType;
        if (typeof window !== "undefined") {
          if (next) window.localStorage.setItem(key, next);
          else window.localStorage.removeItem(key);
        }
        return next;
      });
    },
    [key],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 px-6 py-4">
        <div className="h-12 rounded-xl bg-muted/30 animate-pulse" />
        <div className="h-12 rounded-xl bg-muted/30 animate-pulse" />
        <div className="h-12 rounded-xl bg-muted/30 animate-pulse" />
      </div>
    );
  }

  if (systemPipes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 p-6 text-center">
        <Layers className="w-6 h-6 mx-auto text-muted-foreground/60 mb-2" />
        <p className="text-sm text-muted-foreground">Sem pipes ainda</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {systemPipes.map((pipe) => {
        const open = expanded === pipe.pipeType;
        const terminated = isTerminated(pipe);
        return (
          <PipeSection
            key={pipe.pipeType}
            pipe={pipe}
            open={open}
            terminated={terminated}
            confirmacaoData={confirmacaoData ?? null}
            propostaData={propostaData ?? null}
            leadId={leadId}
            organizationId={organizationId}
            onToggle={() => toggle(pipe.pipeType)}
          />
        );
      })}
    </div>
  );
});

// ─── Section ───────────────────────────────────────────────────────────

interface PipeSectionProps {
  pipe: SystemPipe;
  open: boolean;
  terminated: boolean;
  confirmacaoData: Parameters<typeof MeetingFieldBlock>[0]["pipeData"] | null;
  propostaData: Parameters<typeof BudgetFieldBlock>[0]["pipeData"] | null;
  leadId: string;
  organizationId: string;
  onToggle: () => void;
}

function PipeSection({
  pipe,
  open,
  terminated,
  confirmacaoData,
  propostaData,
  leadId,
  organizationId,
  onToggle,
}: PipeSectionProps) {
  const headerData = renderHeaderKeyData(pipe, confirmacaoData, propostaData);

  return (
    <section
      className={cn(
        "rounded-xl border border-border/40 bg-card overflow-hidden transition-colors",
        open && "ring-1 ring-primary/20",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors",
        )}
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: pipe.color }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{pipe.label}</span>
            {pipe.currentStageLabel && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {pipe.currentStageLabel}
              </Badge>
            )}
            {terminated && (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                Encerrado
              </Badge>
            )}
            {headerData}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          <PipeBody
            pipe={pipe}
            confirmacaoData={confirmacaoData}
            propostaData={propostaData}
            leadId={leadId}
            organizationId={organizationId}
          />
        </div>
      )}
    </section>
  );
}

// ─── Header key data ──────────────────────────────────────────────────

function renderHeaderKeyData(
  pipe: SystemPipe,
  confirmacaoData: PipeSectionProps["confirmacaoData"],
  propostaData: PipeSectionProps["propostaData"],
) {
  if (pipe.pipeType === "confirmacao" && confirmacaoData?.meeting_date) {
    const dt = new Date(confirmacaoData.meeting_date);
    const urgency = meetingUrgency(dt);
    return (
      <>
        <span className="text-xs text-muted-foreground">
          {format(dt, "dd/MM 'às' HH:mm", { locale: ptBR })}
        </span>
        {urgency && (
          <Badge variant="outline" className={cn("text-[10px]", urgency.tone)}>
            {urgency.label}
          </Badge>
        )}
      </>
    );
  }

  if (pipe.pipeType === "propostas" && propostaData?.sale_value) {
    return (
      <span className="text-xs font-medium text-success">
        {formatBRL(Number(propostaData.sale_value))}
      </span>
    );
  }

  if (pipe.pipeType === "qualificacao" && pipe.currentStageLabel) {
    // Stage label is already rendered above; nothing extra.
    return null;
  }

  return null;
}

// ─── Body per pipe ────────────────────────────────────────────────────

function PipeBody({
  pipe,
  confirmacaoData,
  propostaData,
  leadId,
  organizationId,
}: Pick<
  PipeSectionProps,
  "pipe" | "confirmacaoData" | "propostaData" | "leadId" | "organizationId"
>) {
  if (pipe.pipeType === "confirmacao") {
    return (
      <MeetingFieldBlock
        leadId={leadId}
        organizationId={organizationId}
        pipeData={confirmacaoData}
        locked={false}
      />
    );
  }

  if (pipe.pipeType === "propostas") {
    return (
      <BudgetFieldBlock
        leadId={leadId}
        organizationId={organizationId}
        pipeData={propostaData}
        locked={false}
      />
    );
  }

  // Qualificação — minimal stage selector via MoveStageButton.
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">
        Stage atual:{" "}
        <span className="text-foreground font-medium">
          {pipe.currentStageLabel ?? "—"}
        </span>
      </div>
      <MoveStageButton
        leadId={leadId}
        organizationId={organizationId}
        variant="whatsapp"
        pipeData={pipe.pipeId ? { id: pipe.pipeId, status: pipe.currentStage ?? undefined } : null}
      />
    </div>
  );
}
