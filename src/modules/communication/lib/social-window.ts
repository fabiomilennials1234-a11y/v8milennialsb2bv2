/**
 * A janela de resposta do Direct — como INFORMAÇÃO, não como bloqueio.
 *
 * A doc do NotificaMe declara: "precisa estar dentro do período de mensagens
 * (até 24 horas após a última resposta do destinatário)".
 *
 * ⚠️ ESTA FUNÇÃO NÃO IMPEDE NADA. A decisão de produto foi deixar o operador
 * tentar: o relógio é nosso, a regra é da Meta, e travar o vendedor por causa de
 * uma conta que pode estar errada é pior do que deixá-lo enviar e ver a recusa
 * do fornecedor — que sobe legível. O papel daqui é MOSTRAR o tempo restante,
 * que é a diferença entre "não consigo responder" e "tenho 3 horas".
 */

/** A janela da Meta, em horas, contada da última mensagem RECEBIDA. */
export const SOCIAL_REPLY_WINDOW_HOURS = 24;

export interface SocialReplyWindow {
  /** `true` aberta, `false` encerrada, `null` = não dá para saber. */
  open: boolean | null;
  /** Texto pronto para a tela. */
  label: string;
  /** Milissegundos restantes, ou `null` quando não há como calcular. */
  remainingMs: number | null;
}

/**
 * @param lastIncomingAt instante da última mensagem RECEBIDA (ISO), ou nulo.
 */
export function socialReplyWindow(
  lastIncomingAt: string | null | undefined,
  now: Date = new Date(),
  opts: {
    /**
     * A thread JÁ CARREGOU e não tem nenhuma mensagem recebida — no canal
     * oficial isso é uma afirmação, não ignorância: sem mensagem do cliente não
     * existe janela, e a Meta só aceita template. Foi o caso de 13/10 (Sampaio e
     * Moraes): seis textos livres para contatos que nunca escreveram, seis
     * recusas, e nenhum aviso antes — porque "nunca recebeu" caía em "não sei".
     */
    semRecebidaEhFechada?: boolean;
  } = {},
): SocialReplyWindow {
  if (!lastIncomingAt) {
    if (opts.semRecebidaEhFechada) {
      return { open: false, label: "Este contato ainda não te escreveu", remainingMs: 0 };
    }
    // Thread só de saída, ou vazia. `null` é "não sei" — e a tela não inventa
    // contador: mostrar "24h restantes" aqui seria uma conta sobre nada.
    return { open: null, label: "", remainingMs: null };
  }

  const inicio = new Date(lastIncomingAt);
  if (Number.isNaN(inicio.getTime())) {
    // Timestamp corrompido virando "janela fechada" bloquearia a tela por um
    // defeito de dado — o oposto da decisão de não travar o operador.
    return { open: null, label: "", remainingMs: null };
  }

  const fim = inicio.getTime() + SOCIAL_REPLY_WINDOW_HOURS * 3_600_000;
  const restante = fim - now.getTime();

  if (restante <= 0) {
    return {
      open: false,
      label: "Janela de resposta encerrada",
      remainingMs: 0,
    };
  }

  // Teto na janela cheia: um timestamp no futuro (relógio do fornecedor adiantado)
  // não pode produzir "31h restantes" nem número negativo em lugar nenhum.
  const efetivo = Math.min(restante, SOCIAL_REPLY_WINDOW_HOURS * 3_600_000);
  const horas = Math.floor(efetivo / 3_600_000);
  const minutos = Math.floor((efetivo % 3_600_000) / 60_000);

  // Abaixo de uma hora o minuto é o que importa; acima, o minuto é ruído.
  const label = horas >= 1
    ? `${horas}h${minutos > 0 ? ` ${minutos}min` : ""} para responder`
    : `${Math.max(1, minutos)} min para responder`;

  return { open: true, label, remainingMs: efetivo };
}

/**
 * A mensagem de SAÍDA foi enviada fora da janela? Lê só o que está na thread.
 *
 * Existe para a recusa que chega SEM motivo: o fornecedor às vezes devolve
 * `failed` sem o código da Meta, e a bolha ficava em "falhou", sem dizer o que
 * fazer. Quando a própria thread mostra que o cliente não escreveu nas 24 horas
 * antes do envio, isso não é palpite — é a regra da Meta aplicada aos nossos
 * dados, e a saída (template) é a mesma qualquer que seja o código.
 *
 * @param enviadaEm instante do envio (ISO)
 * @param recebidasEm instantes das mensagens RECEBIDAS da thread (ISO)
 */
export function enviadaForaDaJanela(enviadaEm: string, recebidasEm: readonly string[]): boolean {
  const envio = new Date(enviadaEm).getTime();
  if (Number.isNaN(envio)) return false;
  const inicio = envio - SOCIAL_REPLY_WINDOW_HOURS * 3_600_000;
  return !recebidasEm.some((r) => {
    const t = new Date(r).getTime();
    return !Number.isNaN(t) && t <= envio && t > inicio;
  });
}
