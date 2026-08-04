import { memo, useCallback } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useViewport } from "@/shared/hooks/use-viewport";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useDealSheet } from "../deal-detail/deal-sheet-context";
import { useLeadSheet } from "../lead-detail/hooks/useLeadSheet";
import { DealCard } from "./DealCard";
import { useDealCardData } from "./useDealCardData";

/**
 * A casca do Card do Negócio — diálogo no desktop, folha no celular.
 *
 * Mesma separação do card do Lead: `DealCard` desenha, `useDealCardData` busca,
 * este arquivo decide onde aparece. É o que permite a rota de visualização
 * existir sem banco.
 *
 * Clicar na pessoa fecha este card e abre o do Lead. Os dois nunca ficam
 * empilhados: são as duas únicas fichas do sistema e cada uma é dona de um
 * assunto — quem empilha passa a ter duas verdades na tela sobre o mesmo lead.
 */
export const DealCardPanel = memo(function DealCardPanel() {
  const { isOpen, entryId, leadId, close } = useDealSheet();
  const { openLead } = useLeadSheet();
  const { isMobile } = useViewport();
  const queryClient = useQueryClient();

  const { data, isLoading } = useDealCardData(entryId, leadId, isOpen);

  const salvarNota = useCallback(
    async (texto: string) => {
      if (!entryId) return;
      const { error } = await supabase
        .from("pipeline_entries")
        .update({ notes: texto })
        .eq("id", entryId);
      if (error) {
        toast.error("Não foi possível salvar a anotação. O texto continua na tela.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["deal-card-extras", entryId] });
    },
    [entryId, queryClient],
  );

  const abrirLead = useCallback(
    (id: string) => {
      close();
      openLead(id);
    },
    [close, openLead],
  );

  const conteudo = isLoading ? (
    <div className="flex h-full items-center justify-center rounded-xl border border-border bg-background">
      <span className="text-[13px] text-muted-foreground">Carregando…</span>
    </div>
  ) : data ? (
    <DealCard negocio={data} onOpenLead={abrirLead} onSaveNote={salvarNota} />
  ) : (
    <div className="flex h-full items-center justify-center rounded-xl border border-border bg-background px-6 text-center">
      <span className="text-[13px] text-muted-foreground">Negócio não encontrado.</span>
    </div>
  );

  if (!isOpen) return null;

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
      <DialogContent className="h-[84vh] max-w-[900px] gap-0 overflow-hidden p-0">
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
