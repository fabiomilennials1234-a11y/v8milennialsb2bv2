/**
 * `decidirAberturaConversa` — abre direto ou pergunta?
 *
 * Decisão 1 da spec: com mais de uma caixa o produto SEMPRE pergunta, mesmo
 * que só uma tenha histórico. A resposta "óbvia" não ganha atalho — duas
 * regras para a mesma pergunta é exatamente como `primaryInstanceId` virou
 * prop morta: existia um caminho opcional, e ele apodreceu sem ninguém ver.
 *
 * A contagem é das caixas EXIBIDAS, não das que o usuário pode escrever. Uma
 * caixa em modo leitura ainda é uma escolha real: abrir o histórico dela é
 * diferente de abrir o de outra (decisões 5 e 6).
 */
import type { ConversaDoLeadRow } from "./agruparConversasDoLead";

export type DecisaoAberturaConversa =
  | { acao: "sem-caixa" }
  | { acao: "abrir"; instanceId: string }
  | { acao: "perguntar" };

export function decidirAberturaConversa({
  caixas,
}: {
  caixas: ReadonlyArray<ConversaDoLeadRow>;
}): DecisaoAberturaConversa {
  if (caixas.length === 0) return { acao: "sem-caixa" };
  if (caixas.length === 1) return { acao: "abrir", instanceId: caixas[0].instanceId };
  return { acao: "perguntar" };
}
