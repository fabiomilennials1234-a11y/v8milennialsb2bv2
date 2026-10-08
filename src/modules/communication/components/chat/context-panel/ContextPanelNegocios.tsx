/**
 * ContextPanelNegocios — seção "Negócios" do painel lateral do chat.
 *
 * Resumo de cada negócio do lead da conversa: título, estado, valor,
 * responsável, data de criação e funil · etapa. Clicar abre o Card do Negócio
 * (o mesmo `DealCardPanel` que os funis e a lista de Leads abrem) sem sair da
 * conversa.
 *
 * Piloto por org — quem decide se monta é `mostraNegocioNoChat`, no
 * `ContextPanelTabInfo`. Os providers moram aqui dentro, e não no shell do
 * chat, para que nenhuma outra org carregue nada disto.
 */
import { useState } from "react";
import { Briefcase, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DealCardPanel,
  DealPanelProvider,
  LeadCardPanel,
  LeadPanelProvider,
  LeadNewDealDialog,
  useLeadActionGates,
  useDealSheet,
} from "@/modules/leads";
import { useNegociosDoLeadNoChat } from "@/modules/communication/hooks/chat/useNegociosDoLeadNoChat";
import { CartaoDoNegocio } from "./CartaoDoNegocio";

interface ContextPanelNegociosProps {
  leadId: string;
}

export function ContextPanelNegocios({ leadId }: ContextPanelNegociosProps) {
  const [criando, setCriando] = useState(false);
  const { canAddToPipe } = useLeadActionGates(leadId);

  return (
    <LeadPanelProvider>
      <DealPanelProvider>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-3 w-full gap-2"
          disabled={canAddToPipe.isLoading || !canAddToPipe.allowed}
          title={canAddToPipe.isLoading ? "Carregando permissões" : !canAddToPipe.allowed ? canAddToPipe.reason : undefined}
          onClick={() => setCriando(true)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Adicionar negócio
        </Button>
        <ListaDeNegocios leadId={leadId} />
        {criando && <LeadNewDealDialog leadId={leadId} open onOpenChange={setCriando} />}
        <DealCardPanel />
        <LeadCardPanel />
      </DealPanelProvider>
    </LeadPanelProvider>
  );
}

function ListaDeNegocios({ leadId }: { leadId: string }) {
  const { negocios, isLoading, isError, refetch } = useNegociosDoLeadNoChat(leadId, true);
  const { openDeal } = useDealSheet();

  if (isError) {
    return (
      <div role="alert" className="space-y-2 py-4 text-center text-xs text-muted-foreground">
        <p>Não foi possível carregar os negócios.</p>
        <button type="button" className="text-primary underline" onClick={() => void refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando negócios" />
      </div>
    );
  }

  if (negocios.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Briefcase className="h-7 w-7 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">Lead sem negócio</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {negocios.map((n) => (
        <li key={n.id}>
          <CartaoDoNegocio
            negocio={n}
            onAbrir={n.vendaHistorica ? undefined : () => openDeal(n.id, n.leadId)}
          />
        </li>
      ))}
    </ul>
  );
}
