import { useCurrentTeamMember } from "@/modules/identity";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useLeadAllPipelines, type PipelineStatus } from "../../hooks/useLeadAllPipelines";
import { usePipeOps } from "../../pipe-ops";
import { useLeadActionGates } from "../lead-detail/hooks/useLeadActionGates";
import { NewDealDialog } from "../lead-detail/modal/pipes/NewDealDialog";
import { useAbrirNegocio } from "../lead-detail/modal/pipes/useAbrirNegocio";

/**
 * "Criar negócio" a partir do Card do Lead — `inv:H5-18`.
 *
 * O botão já existia em `LeadCardDeals` e não ia a lugar nenhum: `onNewDeal`
 * subia até `LeadCardPanel` e morria lá, porque ninguém passava a prop. O card
 * listava os negócios da pessoa e não tinha porta para abrir o próximo.
 *
 * Este arquivo é a porta, e é separado por dois motivos que valem o arquivo:
 *
 *   1. **O card continua sem banco.** `LeadCard`/`LeadCardDeals` não conhecem
 *      Supabase nem react-query — é o que mantém a rota de visualização de pé
 *      com dados de exemplo. Toda a busca fica deste lado da fronteira;
 *   2. **A regra de quais funis aceitam negócio não é recalculada aqui.** Ela
 *      vem de `buildNewDealOptions`, o mesmo construtor que o `CrossPipePanel`
 *      passou a importar no mesmo diff. Duas telas oferecendo listas diferentes
 *      de funil seria o bug caro; uma cópia da regra é como ele nasceria.
 *
 * A escrita sai por `useAbrirNegocio` → RPC `abrir_negocio`, a porta única da
 * ADR-0023 decisão 3: negócio nasce por clique humano, e este é um clique.
 */
export function LeadCardNewDeal({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const memberQuery = useCurrentTeamMember();
  const teamMember = memberQuery.data;
  const organizationId = teamMember?.organization_id ?? null;

  /**
   * Só busca com o modal aberto.
   *
   * `useLeadAllPipelines` dispara cinco queries; o Card do Lead abre em toda
   * linha da lista e na maioria delas ninguém vai criar negócio nenhum. Passar
   * `null` desabilita a query (`enabled: !!leadId`) em vez de pagá-la sempre.
   */
  const alvo = open ? leadId : null;
  const pipelinesQuery = useLeadAllPipelines(alvo);
  const { canAddToPipe } = useLeadActionGates(leadId);
  const { usePipePropostaByLeadId, useCustomPipelines } = usePipeOps();
  const propostaQuery = usePipePropostaByLeadId(alvo);
  // A lista custom compõe a chave de useLeadAllPipelines. Esperar ambas evita
  // abrir com opções parciais e trocar o formulário enquanto a pessoa digita.
  const customQuery = useCustomPipelines();

  const { options, isCreating, criar } = useAbrirNegocio({
    leadId,
    organizationId,
    pipelines: (pipelinesQuery.data ?? []) as PipelineStatus[],
    canAdd: canAddToPipe,
    vendaFechada: propostaQuery.data?.status === "vendido",
  });

  if (!open) return null;

  const queries = [memberQuery, pipelinesQuery, propostaQuery, customQuery];
  const isError = queries.some((query) => query.isError);
  const isLoading = queries.some((query) => query.isPending) || canAddToPipe.isLoading;

  // O formulário inicializa funil/etapa ao abrir. Só montá-lo com os dados
  // prontos também diferencia indisponibilidade de "nenhum funil disponível".
  if (isError || isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg z-[60]" overlayClassName="z-[60]">
          <DialogHeader>
            <DialogTitle>Novo negócio</DialogTitle>
            <DialogDescription>Escolha um funil para o novo negócio.</DialogDescription>
          </DialogHeader>
          {isError ? (
            <div role="alert" className="space-y-3 text-sm">
              <p>Não foi possível carregar os funis. Tente novamente.</p>
              <Button variant="outline" onClick={() => void Promise.all(queries.map((query) => query.refetch()))}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando funis e permissões…
            </p>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <NewDealDialog
      options={options}
      isCreating={isCreating}
      onCreate={criar}
      open={open}
      onOpenChange={onOpenChange}
      hideTrigger
      size="md"
    />
  );
}
