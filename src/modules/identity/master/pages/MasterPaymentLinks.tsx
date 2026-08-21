/**
 * MasterPaymentLinks — montar a proposta e acompanhar as já geradas.
 *
 * DUAS SEÇÕES NA MESMA PÁGINA, e não duas telas: quem gera é quem revoga, e o
 * caso mais comum depois de gerar é olhar a lista para conferir o que saiu. Um
 * roteamento no meio disso só cobraria um clique para voltar ao contexto que a
 * pessoa nunca deixou.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentLinkComposer } from "../components/PaymentLinkComposer";
import { PaymentLinksList } from "../components/PaymentLinksList";

export default function MasterPaymentLinks() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Propostas de pagamento</h1>
        <p className="text-sm text-muted-foreground">
          Monte o pacote, cote com o motor e gere o link que o cliente paga.
        </p>
      </div>

      <Tabs defaultValue="compose">
        <TabsList>
          <TabsTrigger value="compose">Montar proposta</TabsTrigger>
          <TabsTrigger value="list">Propostas geradas</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="mt-6">
          <PaymentLinkComposer />
        </TabsContent>

        <TabsContent value="list" className="mt-6">
          <PaymentLinksList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
