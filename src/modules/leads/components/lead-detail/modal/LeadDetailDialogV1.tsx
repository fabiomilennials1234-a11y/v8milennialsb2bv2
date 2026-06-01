import { memo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useLeadSheet } from "../hooks/useLeadSheet";
import { LeadDetailSheet as LegacyLeadDetailSheet } from "../LeadDetailSheet";
import { cn } from "@/lib/utils";

/**
 * V1 — modal legado pré-redesign (split-pane lateral).
 *
 * Renderiza o `LeadDetailSheet` original dentro do mesmo shell Dialog/Sheet
 * usado pela V2 para preservar o contrato de "abrir um modal centralizado"
 * dos call sites. Acessado apenas quando a feature flag
 * `new_lead_modal_v2` está DESLIGADA na organização.
 */
export const LeadDetailDialogV1 = memo(function LeadDetailDialogV1() {
  const { isOpen, close } = useLeadSheet();
  const { isMobile } = useViewport();

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          className="h-[95vh] p-0 overflow-hidden flex flex-col"
          aria-describedby={undefined}
        >
          <LegacyLeadDetailSheet />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-sm bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
            "w-[min(1280px,calc(100vw-32px))] h-[min(900px,calc(100vh-32px))]",
            "rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200"
          )}
        >
          <DialogPrimitive.Title className="sr-only">Detalhes do lead</DialogPrimitive.Title>
          <LegacyLeadDetailSheet />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
});
