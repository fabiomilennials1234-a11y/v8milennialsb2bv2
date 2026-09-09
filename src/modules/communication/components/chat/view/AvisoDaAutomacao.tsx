/**
 * `AvisoDaAutomacao` — "a automação responderia por outro número".
 *
 * ─── POR QUE ESTE AVISO EXISTE (D7) ─────────────────────────────────────────
 *
 * O motor resolve a Instance de saída pela mensagem MAIS RECENTE daquele
 * telefone, atravessando caixas (política `conversation`, ADR-0025). A caixa
 * unificada mostra uma Conversa do Lead por caixa. As duas leituras são
 * verdadeiras em camadas diferentes — e o vendedor que responde pelo Chip
 * enquanto o Workflow responde pelo oficial está falando por cima do robô.
 *
 * Na Chique isso é concreto: 6 Workflows ativos de WhatsApp e 10 contatos com
 * conversa nas duas caixas.
 *
 * ─── SÓ APARECE NA DIVERGÊNCIA ──────────────────────────────────────────────
 *
 * Quando a automação usaria a MESMA caixa que está aberta, não há nada a dizer.
 * Aviso constante é o que treina a pessoa a ignorar o aviso que importa — e
 * aqui ele importa em 10 conversas de 664.
 *
 * ⚠️ O motor NÃO é tocado. Esta tela só lê a mesma regra para exibir; corrigir
 *    a divergência reintroduziria o defeito que o ADR-0025 corrigiu.
 */
import { useMemo } from "react";
import { Bot } from "lucide-react";
import { useConversasDoLead } from "@/modules/communication/hooks/chat/useConversasDoLead";
import {
  automacaoRespondePorOutraCaixa,
  instanciaDaAutomacao,
} from "@/modules/communication/lib/instanciaDaAutomacao";

export interface AvisoDaAutomacaoProps {
  /** O telefone da conversa aberta. Sem ele não há o que perguntar. */
  telefone: string | null;
  /** A caixa da conversa aberta — é com ela que a comparação acontece. */
  caixaAberta: string | null;
}

export function AvisoDaAutomacao({ telefone, caixaAberta }: AvisoDaAutomacaoProps) {
  // A MESMA RPC do seletor de Conversa do Lead: ela devolve, por caixa da
  // organização, a última mensagem trocada com o telefone — nas duas tabelas,
  // desde a migration 20270927000000. O TanStack dedupa com o seletor quando os
  // dois estão na tela, então o custo aqui é zero na prática (0,27 ms medidos).
  const { data: caixas = [] } = useConversasDoLead(telefone);

  const automacao = useMemo(
    () =>
      instanciaDaAutomacao(
        caixas.map((c) => ({
          instanceId: c.instanceId,
          instanceName: c.instanceName,
          lastMessageAt: c.lastMessageAt,
        })),
      ),
    [caixas],
  );

  if (!automacaoRespondePorOutraCaixa(caixaAberta, automacao) || !automacao) {
    return null;
  }

  return (
    <div
      className="flex items-start gap-2 border-b border-border/60 bg-amber-500/[0.06] px-4 py-2"
      role="status"
    >
      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
      <p className="text-[12px] leading-snug text-muted-foreground">
        Uma automação responderia a este contato por{" "}
        <span className="font-medium text-foreground">{automacao.instanceName}</span> — foi por
        lá que passou a mensagem mais recente dele. Respondendo aqui, vocês falam por dois
        números diferentes.
      </p>
    </div>
  );
}
