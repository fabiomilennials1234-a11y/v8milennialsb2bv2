import { useId, useRef, type RefObject } from "react";
import { Anchor } from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { DealCardChecklists } from "../../deal-card/DealCardChecklists";
import { useViewport } from "@/shared/hooks/use-viewport";

interface LeadCardChecklistsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardRef: RefObject<HTMLDivElement>;
  returnFocusRef: RefObject<HTMLButtonElement>;
  leadId: string;
  entryId: string | null;
  leadName: string;
}

/** Painel ancorado no card; monta as consultas apenas enquanto está aberto. */
export function LeadCardChecklistsPanel({
  open, onOpenChange, cardRef, returnFocusRef, leadId, entryId, leadName,
}: LeadCardChecklistsPanelProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { isMobile } = useViewport();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Anchor virtualRef={cardRef} />
      <PopoverContent
        onFocusOutside={(e) => {
          // Ao sair da linha sob o ponteiro, o menu que está fechando pode
          // recuperar o foco. Isso não é uma saída intencional do painel.
          const target = e.detail.originalEvent.target;
          if (target instanceof HTMLElement && target.closest('[role="menu"][data-state="closed"]')) {
            e.preventDefault();
            closeRef.current?.focus();
          }
        }}
        side={isMobile ? "bottom" : "right"}
        align="start"
        sideOffset={10}
        collisionPadding={12}
        aria-labelledby={titleId}
        className="flex max-h-[min(480px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl p-0 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          closeRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-[13px] font-semibold">Checklists</h3>
            <p className="truncate text-[11px] text-muted-foreground" title={leadName}>{leadName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Fechar checklists"
            onClick={() => onOpenChange(false)}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
          {open && <DealCardChecklists leadId={leadId} entryId={entryId} compact />}
        </div>
      </PopoverContent>
    </Popover>
  );
}
