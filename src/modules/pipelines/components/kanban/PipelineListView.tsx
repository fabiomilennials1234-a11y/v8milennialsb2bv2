import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Stage {
  id: string;
  name: string;
  stage_key: string;
  color?: string;
}

interface Lead {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  stage_key: string;
  created_at: string;
  updated_at?: string;
}

export interface PipelineListViewProps {
  stages: Stage[];
  leads: Lead[];
  onLeadClick: (leadId: string) => void;
  onMoveLeadToStage: (leadId: string, newStageKey: string) => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}m`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MoveMenu({
  leadId,
  stages,
  onMove,
}: {
  leadId: string;
  stages: Stage[];
  onMove: (leadId: string, stageKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 rounded-full px-3 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:opacity-100"
        aria-label="Mover"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowRightLeft />
        Mover
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-2xl border border-border bg-popover p-1.5 shadow-relevo-alto"
        >
          {stages.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent"
              onClick={() => {
                onMove(leadId, s.stage_key);
                setOpen(false);
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color || "#888" }}
              />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCardItem({
  lead,
  stages,
  currentStageKey,
  onLeadClick,
  onMoveLeadToStage,
}: {
  lead: Lead;
  stages: Stage[];
  currentStageKey: string;
  onLeadClick: (leadId: string) => void;
  onMoveLeadToStage: (leadId: string, newStageKey: string) => void;
}) {
  const otherStages = stages.filter((s) => s.stage_key !== currentStageKey);
  const timeRef = lead.updated_at || lead.created_at;

  return (
    <div
      data-testid="lead-card"
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-2xl border border-card-border bg-card p-3.5 shadow-relevo",
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-relevo-alto motion-reduce:hover:translate-y-0",
      )}
      onClick={() => onLeadClick(lead.id)}
    >
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold tracking-[-0.01em]">{lead.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {relativeTime(timeRef)}
          </span>
        </div>

        {lead.company && (
          <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
        )}

        {lead.phone && (
          <p className="truncate text-xs tabular-nums text-muted-foreground">{lead.phone}</p>
        )}
      </div>

      {/* Move action — simple menu (mobile-friendly, no portal) */}
      <MoveMenu
        leadId={lead.id}
        stages={otherStages}
        onMove={onMoveLeadToStage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineListView({
  stages,
  leads,
  onLeadClick,
  onMoveLeadToStage,
  isLoading,
}: PipelineListViewProps) {
  const [activeStageKey, setActiveStageKey] = useState<string>(
    stages[0]?.stage_key ?? ""
  );

  const filteredLeads = useMemo(
    () => leads.filter((l) => l.stage_key === activeStageKey),
    [leads, activeStageKey]
  );

  const countByStage = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of leads) {
      map[l.stage_key] = (map[l.stage_key] || 0) + 1;
    }
    return map;
  }, [leads]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-3">
        {/* Chip skeletons */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full shrink-0" />
          ))}
        </div>
        {/* Card skeletons */}
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton
            key={i}
            data-testid="skeleton-card"
            className="h-[72px] w-full rounded-2xl"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stage filter chips — horizontal scroll */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {stages.map((stage) => {
          const isActive = stage.stage_key === activeStageKey;
          const count = countByStage[stage.stage_key] || 0;

          return (
            <button
              key={stage.id}
              role="button"
              aria-pressed={isActive}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // Etapa escolhida em TINTA (V5): o ouro da página já é do botão
                // primário e da pílula de visões — aqui seria o terceiro.
                isActive
                  ? "bg-tinta text-tinta-foreground shadow-relevo-tinta"
                  : "border border-card-border bg-card text-muted-foreground shadow-relevo hover:text-foreground"
              )}
              onClick={() => setActiveStageKey(stage.stage_key)}
            >
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: stage.color || "#888" }}
              />
              {stage.name}
              <span
                className={cn(
                  "text-xs font-bold tabular-nums",
                  isActive ? "text-tinta-muted" : "text-muted-foreground/70"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lead cards */}
      {filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-panel border border-dashed border-border bg-card/50 py-14 text-muted-foreground">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm">Nenhum lead nesta etapa</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredLeads.map((lead) => (
            <LeadCardItem
              key={lead.id}
              lead={lead}
              stages={stages}
              currentStageKey={activeStageKey}
              onLeadClick={onLeadClick}
              onMoveLeadToStage={onMoveLeadToStage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
