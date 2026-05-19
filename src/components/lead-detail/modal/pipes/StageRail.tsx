import { memo, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CrossPipeMoveTarget } from "./useCrossPipeMove";

/**
 * StageRail — single horizontal row of stage segments for one pipe the
 * lead currently belongs to. Replaces the popover-driven `MoveStageButton`
 * with an always-visible `role=tablist`.
 *
 * Each segment is keyboard-navigable (arrow left/right cycle focus,
 * Enter/Space activates the move). The currently active segment scrolls
 * into view on mount so users see "where they are".
 */

export type StageRailKind = "system" | "custom";

export interface StageRailStage {
  /** stage_key for system pipes, uuid for custom pipes. */
  key: string;
  label: string;
}

export interface StageRailPipe {
  /** "system" | "custom" — drives move payload shape. */
  kind: StageRailKind;
  /** ID for the entry being moved. */
  recordId: string;
  /** System: "whatsapp" | "confirmacao" | "propostas". Custom: pipeline uuid. */
  pipeRef: string;
  /** Short label rendered before the segments. */
  shortLabel: string;
  /** Tiny color dot before the label. */
  color: string;
  /** Stages in display order. */
  stages: StageRailStage[];
  /** Key of the currently active stage. */
  currentKey: string | null;
}

interface StageRailProps {
  pipe: StageRailPipe;
  pendingStageKey: string | null;
  recentlyMovedStageKey: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onMove: (target: CrossPipeMoveTarget) => void;
}

const PIPE_TABLE: Record<string, "pipe_whatsapp" | "pipe_confirmacao" | "pipe_propostas"> = {
  whatsapp: "pipe_whatsapp",
  confirmacao: "pipe_confirmacao",
  propostas: "pipe_propostas",
};

export const StageRail = memo(function StageRail({
  pipe,
  pendingStageKey,
  recentlyMovedStageKey,
  disabled,
  disabledReason,
  onMove,
}: StageRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const currentBtnRef = useRef<HTMLButtonElement | null>(null);

  // Auto-scroll current into view on mount and whenever current changes.
  // Defensive: jsdom doesn't implement scrollIntoView; guard against
  // environments where the prototype lacks it.
  useEffect(() => {
    const node = currentBtnRef.current;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }, [pipe.currentKey, pipe.stages.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target?.dataset?.stageIndex) return;
    const idx = Number(target.dataset.stageIndex);
    if (Number.isNaN(idx)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? idx + 1 : idx - 1;
      const all = trackRef.current?.querySelectorAll<HTMLButtonElement>("[data-stage-index]");
      if (!all) return;
      const target = all[(next + all.length) % all.length];
      target?.focus();
    }
  };

  const handleActivate = (stage: StageRailStage) => {
    if (disabled) return;
    if (stage.key === pipe.currentKey) return;
    if (pendingStageKey !== null) return;
    if (pipe.kind === "system") {
      const table = PIPE_TABLE[pipe.pipeRef];
      if (!table) return;
      onMove({
        kind: "system",
        pipeTable: table,
        pipeId: pipe.recordId,
        stageKey: stage.key,
        stageLabel: stage.label,
      });
    } else {
      onMove({
        kind: "custom",
        entryId: pipe.recordId,
        stageId: stage.key,
        stageLabel: stage.label,
      });
    }
  };

  const currentIdx = pipe.stages.findIndex((s) => s.key === pipe.currentKey);

  return (
    <div
      className="group flex items-center gap-3 h-9 px-2.5 rounded-lg hover:bg-muted/30 transition-colors"
      data-testid={`stage-rail-${pipe.pipeRef}`}
    >
      <div className="flex items-center gap-2 w-[120px] shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: pipe.color }}
          aria-hidden
        />
        <span className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider truncate">
          {pipe.shortLabel}
        </span>
      </div>
      <div role="tablist" className="flex-1 relative min-w-0" onKeyDown={handleKeyDown}>
        <div
          ref={trackRef}
          className="flex items-center gap-1 overflow-x-auto scrollbar-hide min-w-0"
        >
          {pipe.stages.map((stage, idx) => {
            const active = stage.key === pipe.currentKey;
            const completed = currentIdx >= 0 && idx < currentIdx;
            const isPending = pendingStageKey === stage.key;
            const isRecentlyMoved = active && recentlyMovedStageKey === stage.key;

            const stateClasses = active
              ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_4px_12px_-4px_hsl(var(--primary)/0.5)] font-semibold"
              : completed
                ? "bg-primary/15 text-primary/90 hover:bg-primary/25"
                : "bg-muted/40 text-muted-foreground/60 hover:bg-muted/70 hover:text-foreground";

            const seg = (
              <button
                key={stage.key}
                ref={active ? currentBtnRef : undefined}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? "step" : undefined}
                data-stage-index={idx}
                data-stage-key={stage.key}
                data-stage-state={active ? "current" : completed ? "completed" : "pending"}
                disabled={disabled || isPending}
                tabIndex={active ? 0 : -1}
                onClick={() => handleActivate(stage)}
                className={cn(
                  "relative flex-1 min-w-0 h-7 px-2.5 rounded-md text-[11px] font-medium leading-none",
                  "flex items-center justify-center",
                  "transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  stateClasses,
                  isPending && "motion-safe:animate-pulse",
                  disabled && "opacity-50 cursor-not-allowed pointer-events-none",
                  isRecentlyMoved && "motion-safe:animate-[stage-confirm_250ms_ease-out]",
                )}
                data-testid={`stage-segment-${pipe.pipeRef}-${stage.key}`}
              >
                <span className="truncate">{stage.label}</span>
                {isPending && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/30 rounded-md">
                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                  </span>
                )}
              </button>
            );

            if (disabled && disabledReason) {
              return (
                <TooltipProvider key={stage.key}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1 min-w-0 inline-flex">{seg}</span>
                    </TooltipTrigger>
                    <TooltipContent>{disabledReason}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            }
            return seg;
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
          aria-hidden
        />
      </div>
    </div>
  );
});
