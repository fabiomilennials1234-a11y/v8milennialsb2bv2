import { memo, useCallback } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useViewport } from "@/shared/hooks/use-viewport";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useDealSheet } from "../deal-detail/deal-sheet-context";
import { useLeadSheet } from "../lead-detail/hooks/useLeadSheet";
import { useCrossPipeMove } from "../lead-detail/modal/pipes/useCrossPipeMove";
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

  /**
   * Mover de etapa — inclusive ganhar e perder, que são movimentos para a
   * etapa terminal (ADR-0023 §5: a posição mora no card e é uma só).
   *
   * Reusa `useCrossPipeMove`, o mesmo motor do `StageRail` do card antigo:
   * ele já invalida o board que hospeda o modal, a camada de negócio que a
   * lista de Leads lê e o log de ação. Escrever mutação nova aqui criaria um
   * segundo caminho de escrita para a mesma coisa — e é assim que as duas
   * verdades voltam.
   */
  const { move, pendingStageKey } = useCrossPipeMove(leadId ?? "");

  const moverEtapa = useCallback(
    async (chave: string) => {
      if (!data || !entryId) return;
      const etapa = data.etapas.find((e) => e.chave === chave);
      if (!etapa) return;

      if (data.pipeTable) {
        await move({
          kind: "system",
          pipeTable: data.pipeTable,
          pipeId: entryId,
          stageKey: chave,
          stageLabel: etapa.nome,
        });
      } else {
        await move({ kind: "custom", entryId, stageId: chave, stageLabel: etapa.nome });
      }
    },
    [data, entryId, move],
  );

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
    <DealCard
      negocio={data}
      onOpenLead={abrirLead}
      onSaveNote={salvarNota}
      onMoverEtapa={moverEtapa}
      movendo={pendingStageKey}
    />
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
      {/* Sem botão de fechar próprio: o `DialogContent` já desenha um
          `DialogPrimitive.Close` em `right-4 top-4` (ui/dialog.tsx:48-51).
          O botão que existia aqui ficava em `right-3 top-3` — 4px ao lado —
          e o resultado era DOIS "X" quase sobrepostos no canto.
          Fica o do primitivo: ele já traz rótulo `sr-only`, fecha no Esc e
          devolve o foco ao gatilho, e é o mesmo de todo diálogo do produto. */}
      <DialogContent className="h-[84vh] max-w-[900px] gap-0 overflow-hidden p-0">
        {conteudo}
      </DialogContent>
    </Dialog>
  );
});
