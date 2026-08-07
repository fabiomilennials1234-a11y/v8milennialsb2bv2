import { useCurrentTeamMember } from "@/modules/identity";

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
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  /**
   * Só busca com o modal aberto.
   *
   * `useLeadAllPipelines` dispara cinco queries; o Card do Lead abre em toda
   * linha da lista e na maioria delas ninguém vai criar negócio nenhum. Passar
   * `null` desabilita a query (`enabled: !!leadId`) em vez de pagá-la sempre.
   */
  const alvo = open ? leadId : null;
  const { data: pipelines = [] } = useLeadAllPipelines(alvo);
  const { canAddToPipe } = useLeadActionGates(leadId);
  const { usePipePropostaByLeadId } = usePipeOps();
  const { data: proposta } = usePipePropostaByLeadId(alvo);

  const { options, isCreating, criar } = useAbrirNegocio({
    leadId,
    organizationId,
    pipelines: pipelines as PipelineStatus[],
    canAdd: canAddToPipe,
    vendaFechada: proposta?.status === "vendido",
  });

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
