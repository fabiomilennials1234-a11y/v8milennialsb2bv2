/**
 * `instanciaDaAutomacao` — por qual caixa uma automação responderia a este
 * contato. PURO.
 *
 * ─── A DIVERGÊNCIA QUE ISTO TORNA HONESTA (D7) ──────────────────────────────
 *
 * O motor resolve a Instance de saída pela política `conversation` do ADR-0025:
 * a Instance da MENSAGEM MAIS RECENTE daquele telefone, atravessando caixas e
 * atravessando as duas tabelas (`whatsapp_messages` do chip e
 * `channel_messages` do canal oficial). Para a automação o contato tem UMA
 * thread.
 *
 * Para a caixa unificada o mesmo contato tem uma Conversa do Lead POR CAIXA. As
 * duas leituras são verdadeiras em camadas diferentes, e o glossário autoriza a
 * divergência — o que ela não pode é ficar invisível: na Chique há 6 Workflows
 * ativos de WhatsApp e 10 contatos com conversa nas duas caixas, e o vendedor
 * que responde pelo Chip enquanto a automação responde pelo oficial está
 * falando por cima do robô sem saber.
 *
 * ⚠️ O MOTOR NÃO É TOCADO. Reabri-lo reintroduz o defeito que o ADR-0025 existe
 *    para corrigir. Esta função só LÊ a mesma regra para exibir.
 *
 * ⚠️ A ENTRADA PRECISA VIR DAS DUAS TABELAS. É `get_conversas_do_lead` quem
 *    garante isso (migration `20270927000000`); antes dela a RPC era cega ao
 *    canal oficial e esta função apontaria o chip para quem só fala no oficial
 *    — pior que não mostrar nada.
 */

/** Uma caixa e quando foi a última mensagem dela com aquele telefone. */
export interface CaixaComUltimaMensagem {
  instanceId: string;
  instanceName: string;
  /** ISO-8601, ou `null` quando aquela caixa nunca falou com o telefone. */
  lastMessageAt: string | null;
}

export interface InstanciaDaAutomacao {
  instanceId: string;
  instanceName: string;
  quando: string;
}

/**
 * A caixa da mensagem mais recente, ou `null` quando nenhuma caixa tem
 * histórico com o telefone.
 *
 * `null` é resposta legítima e frequente: contato novo, chamado a partir do
 * funil. Nesse caso a política `conversation` não tem thread para herdar e o
 * motor cai nas políticas seguintes — dizer qualquer caixa aqui seria inventar.
 */
export function instanciaDaAutomacao(
  caixas: readonly CaixaComUltimaMensagem[],
): InstanciaDaAutomacao | null {
  let vencedora: InstanciaDaAutomacao | null = null;

  for (const caixa of caixas) {
    const quando = caixa.lastMessageAt;
    if (!quando) continue;

    // Comparação de ISO-8601 por string é cronológica. Empate mantém a
    // primeira: a ordem que a RPC devolve já é `last_message_at DESC`, e
    // trocar no empate faria a tela apontar caixas diferentes entre dois
    // renders da mesma resposta.
    if (vencedora === null || quando > vencedora.quando) {
      vencedora = {
        instanceId: caixa.instanceId,
        instanceName: caixa.instanceName,
        quando,
      };
    }
  }

  return vencedora;
}

/**
 * A automação responderia por uma caixa DIFERENTE da que está aberta?
 *
 * É a única pergunta que a tela precisa fazer: quando a resposta é não, avisar
 * seria ruído em cima do caminho normal — e ruído constante é o que treina a
 * pessoa a ignorar o aviso que importa.
 */
export function automacaoRespondePorOutraCaixa(
  caixaAberta: string | null | undefined,
  automacao: InstanciaDaAutomacao | null,
): boolean {
  return !!automacao && !!caixaAberta && automacao.instanceId !== caixaAberta;
}
