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
import { LeadCardContainer } from "../lead-card/LeadCardContainer";
import { DealCard } from "./DealCard";
import { useDealCardData } from "./useDealCardData";

/**
 * A casca do painel — diálogo de DUAS COLUNAS no desktop, folha no celular.
 *
 * Mesma separação de antes: `DealCard` desenha, `useDealCardData` busca, este
 * arquivo decide onde aparece. O que mudou é quantas colunas aparecem.
 *
 * ── DE DOIS PAINÉIS QUE SE EXCLUEM PARA UM DE DUAS COLUNAS ────────────────
 * Até aqui, clicar na pessoa FECHAVA o negócio e abria a ficha do lead. A
 * regra por trás era boa — "quem empilha passa a ter duas verdades na tela
 * sobre o mesmo lead" — mas o preço era alto: para conferir o telefone de quem
 * está do outro lado da proposta, perdia-se o negócio de vista.
 *
 * O print do DataCrazy resolve sem quebrar a regra: **não empilha, encosta**.
 * A pessoa ocupa uma coluna fixa de 356px à esquerda, o negócio ocupa o resto.
 * Continua havendo uma ficha de cada assunto; elas só passaram a caber juntas.
 *
 * A ficha INTEIRA do lead não morreu: o lápis e o "Ver ficha completa" da
 * coluna levam até ela, e a lista de Leads continua abrindo o lead direto.
 */
export const DealCardPanel = memo(function DealCardPanel() {
  const { isOpen, entryId, leadId, close, openDeal } = useDealSheet();
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

  const abrirFicha = useCallback(() => {
    close();
    if (leadId) openLead(leadId);
  }, [close, openLead, leadId]);

  /**
   * Trocar de negócio pela aba "Negócios" sem fechar o painel.
   *
   * `openDeal` do mesmo provider que já está aberto só troca `entryId` — o
   * painel continua montado e a coluna do lead nem recarrega, porque o lead é o
   * mesmo. Fechar e reabrir aqui perderia a rolagem e piscaria a tela inteira
   * para trocar metade dela.
   */
  const trocarNegocio = useCallback(
    (id: string) => {
      if (leadId) openDeal(id, leadId);
    },
    [openDeal, leadId],
  );

  const negocio = isLoading ? (
    <div className="flex h-full flex-1 items-center justify-center bg-background">
      <span className="text-[13px] text-muted-foreground">Carregando…</span>
    </div>
  ) : data ? (
    <DealCard
      negocio={data}
      onSaveNote={salvarNota}
      onMoverEtapa={moverEtapa}
      onOpenDeal={trocarNegocio}
      onNewDeal={abrirFicha}
      movendo={pendingStageKey}
    />
  ) : (
    <div className="flex h-full flex-1 items-center justify-center bg-background px-6 text-center">
      <span className="text-[13px] text-muted-foreground">Negócio não encontrado.</span>
    </div>
  );

  /**
   * `comLead` é o corte de largura, não de importância.
   *
   * No celular não há 356px de sobra para a coluna da pessoa sem espremer o
   * negócio a ponto de a régua de etapas virar textura. Lá o painel volta a ser
   * de uma coluna, e a pessoa continua a um toque pelo card do Lead.
   */
  const conteudo = (comLead: boolean) => (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-background">
      {/* A coluna da pessoa só existe quando há pessoa. Um negócio órfão de lead
          não deveria existir (ADR-0023 §2), mas se existir o painel abre com o
          negócio ocupando tudo em vez de com uma coluna vazia acusando falta. */}
      {comLead && leadId && (
        <LeadCardContainer
          leadId={leadId}
          isOpen={isOpen}
          forma="coluna"
          onAbrirFicha={abrirFicha}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">{negocio}</div>
    </div>
  );

  if (!isOpen) return null;

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(v) => !v && close()}>
        <SheetContent side="bottom" className="h-[92vh] p-0">
          {conteudo(false)}
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
          devolve o foco ao gatilho, e é o mesmo de todo diálogo do produto.

          A largura subiu de 900 para 1240: 356 da coluna da pessoa mais os
          ~880 que o negócio já usava. Abaixo disso a régua de etapas de 7 casas
          — o funil mais longo em prod — perde o nome embaixo de cada círculo. */}
      <DialogContent className="h-[88vh] max-w-[1240px] gap-0 overflow-hidden p-0">
        {conteudo(true)}
      </DialogContent>
    </Dialog>
  );
});
