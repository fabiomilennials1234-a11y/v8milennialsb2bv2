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
        className="h-8 px-2 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity"
        aria-label="Mover"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowRightLeft className="w-4 h-4 mr-1" />
        Mover
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {stages.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-popover-foreground hover:bg-accent transition-colors"
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
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-card/80 cursor-pointer group"
      onClick={() => onLeadClick(lead.id)}
    >
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{lead.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {relativeTime(timeRef)}
          </span>
        </div>

        {lead.company && (
          <p className="text-xs text-muted-foreground truncate">{lead.company}</p>
        )}

        {lead.phone && (
          <p className="text-xs text-muted-foreground truncate">{lead.phone}</p>
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
            className="h-20 w-full rounded-lg"
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
                "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[hsl(47_100%_50%)] text-black"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveStageKey(stage.stage_key)}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  isActive && "opacity-60"
                )}
                style={{ backgroundColor: stage.color || "#888" }}
              />
              {stage.name}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  isActive ? "text-black/60" : "text-muted-foreground/60"
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
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Inbox className="w-10 h-10 opacity-40" />
          <p className="text-sm">Nenhum lead nesta etapa</p>
        </div>
      ) : (
        <div className="space-y-2">
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
