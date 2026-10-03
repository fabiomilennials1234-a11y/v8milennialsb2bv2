/**
 * MasterPaymentLinks — montar a proposta e acompanhar as já geradas.
 *
 * DUAS SEÇÕES NA MESMA PÁGINA, e não duas telas: quem gera é quem revoga, e o
 * caso mais comum depois de gerar é olhar a lista para conferir o que saiu. Um
 * roteamento no meio disso só cobraria um clique para voltar ao contexto que a
 * pessoa nunca deixou.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterPageHeader } from "../components/MasterPageHeader";
import { PaymentLinkComposer } from "../components/PaymentLinkComposer";
import { PaymentLinksList } from "../components/PaymentLinksList";

export default function MasterPaymentLinks() {
  return (
    <Tabs defaultValue="compose" className="space-y-5">
      <MasterPageHeader
        title="Propostas de pagamento"
        subtitle="Monte o pacote, cote com o motor e gere o link que o cliente paga."
        tabs={
          <TabsList aria-label="Seções das propostas" className="max-w-full overflow-x-auto scrollbar-hide">
            <TabsTrigger value="compose">Montar proposta</TabsTrigger>
            <TabsTrigger value="list">Propostas geradas</TabsTrigger>
          </TabsList>
        }
      />

      <TabsContent value="compose" className="mt-0">
        <PaymentLinkComposer />
      </TabsContent>

      <TabsContent value="list" className="mt-0">
        <PaymentLinksList />
      </TabsContent>
    </Tabs>
  );
}
