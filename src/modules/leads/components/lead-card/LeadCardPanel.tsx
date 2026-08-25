import { memo, useEffect, useRef, useState } from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useViewport } from "@/shared/hooks/use-viewport";
import { useLeadSheet } from "../lead-detail/hooks/useLeadSheet";
import { useDealSheet } from "../deal-detail/deal-sheet-context";
import { LeadCardContainer } from "./LeadCardContainer";
import { LeadCardNewDeal } from "./LeadCardNewDeal";

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
  const { isOpen, leadId, close, comentarioDestacadoId } = useLeadSheet();
  const { openDeal } = useDealSheet();
  const { isMobile } = useViewport();

  /**
   * "Criar negócio" (`inv:H5-18`) — o botão vive lá dentro, o diálogo mora aqui.
   *
   * O estado não pode ficar no `LeadCardContainer`: ele é quem busca o lead, e
   * pendurar as cinco queries de funil nele custaria em toda abertura de card —
   * e o card abre em toda linha da lista, onde quase ninguém vai criar negócio.
   */
  const [novoNegocio, setNovoNegocio] = useState(false);

  // Trava de montagem: antes do primeiro "Criar negócio" o diálogo nem existe
  // na árvore (e nenhuma query de funil roda); depois dele fica montado, para o
  // fechamento animar em vez de sumir de um quadro para o outro. Ele já não
  // busca nada com `open` falso.
  const jaAbriu = useRef(false);
  if (novoNegocio) jaAbriu.current = true;

  // Trocar de pessoa com o modal de criação aberto abriria um negócio no lead
  // errado — o alvo vem de `leadId`, que já mudou. Fechar é a única leitura
  // honesta: quem for criar recomeça na pessoa que está na tela.
  useEffect(() => {
    setNovoNegocio(false);
  }, [leadId]);

  const conteudo = (
    <>
      <LeadCardContainer
        leadId={leadId}
        isOpen={isOpen}
        comentarioDestacadoId={comentarioDestacadoId}
        /**
         * Fecha ESTE painel antes de abrir o do Negócio.
         *
         * Antes os dois diálogos se empilhavam — dois `Dialog` do Radix, dois
         * focus-trap, e o Esc fechando só o de cima. Passava despercebido
         * porque o painel do Negócio não mostrava a pessoa. Agora ele tem a
         * coluna do lead dentro, então empilhar põe o MESMO lead duas vezes na
         * tela, um por cima do outro.
         */
        onOpenDeal={(entryId, id) => {
          close();
          openDeal(entryId, id);
        }}
        onNewDeal={() => setNovoNegocio(true)}
      />
      {(novoNegocio || jaAbriu.current) && (
        <LeadCardNewDeal
          leadId={leadId}
          open={novoNegocio}
          onOpenChange={setNovoNegocio}
        />
      )}
    </>
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
      {/* Mesmo defeito que o painel do Negócio tinha: o `DialogContent` já
          desenha o `DialogPrimitive.Close` (ui/dialog.tsx:48-51) e este
          arquivo desenhava um segundo 4px ao lado. Fica só o do primitivo. */}
      <DialogContent className="h-[86vh] max-w-[1180px] gap-0 overflow-hidden p-0">
        {conteudo}
      </DialogContent>
    </Dialog>
  );
});
