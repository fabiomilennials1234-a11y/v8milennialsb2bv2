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
): SocialReplyWindow {
  if (!lastIncomingAt) {
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
