import { memo } from "react";
import { X } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useLeadSheet } from "../lead-detail/hooks/useLeadSheet";
import { useDealSheet } from "../deal-detail/deal-sheet-context";
import { LeadCardContainer } from "./LeadCardContainer";

/**
 * A casca do Card do Lead — diálogo no desktop, folha no celular.
 *
 * Fica separada do card e do container porque cada um responde por uma coisa:
 * `LeadCard` desenha, `LeadCardContainer` busca, e este arquivo só decide onde
 * a coisa aparece. Foi assim que a rota de visualização pôde existir sem banco.
 *
 * Clicar num negócio entrega o `pipeline_entries.id` para o
 * `DealPanelProvider`, que abre o **card do Negócio** por cima — o card que já
 * existe e já é o que os três funis abrem. É esse encaixe que faz o corte
 * Lead↔Negócio não tirar nada de ninguém.
 */
export const LeadCardPanel = memo(function LeadCardPanel() {
  const { isOpen, leadId, close } = useLeadSheet();
  const { openDeal } = useDealSheet();
  const { isMobile } = useViewport();

  const conteudo = (
    <LeadCardContainer
      leadId={leadId}
      isOpen={isOpen}
      onOpenDeal={(entryId, id) => openDeal(entryId, id)}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(v) => !v && close()}>
        <SheetContent side="bottom" className="h-[92vh] p-0">
          {conteudo}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && close()}>
      <DialogContent className="h-[86vh] max-w-[1180px] gap-0 overflow-hidden p-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label="Fechar"
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </Button>
        {conteudo}
      </DialogContent>
    </Dialog>
  );
});
