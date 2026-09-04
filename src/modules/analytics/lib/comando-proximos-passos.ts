/**
 * Regras puras dos cards de "Próximos passos".
 *
 * Ficam fora dos componentes pelo mesmo motivo de `comando-escopo.ts`: decisão
 * de lista se testa sem React, sem banco e sem relógio do sistema — e as três
 * regras abaixo já erraram na versão anterior da tela (fila contando conversa
 * sem lead, contador do cabeçalho maior que a lista, "hoje" preso ao horário em
 * que a aba foi aberta).
 */

/** O mínimo que a regra de fila precisa saber sobre uma conversa. */
export interface ConversaParaFila {
  leadId: string | null;
  lastClientMessageAt: string;
}

/**
 * A fila de "aguardando resposta": só conversa com LEAD cadastrado, mais
 * recente primeiro.
 *
 * Decisão do CTO em 2026-09-04. O card é uma fila de trabalho sobre gente
 * conhecida; número solto continua no /chat, onde há como vinculá-lo.
 *
 * Devolve a lista inteira filtrada — quem corta é o chamador, porque o TOTAL
 * exibido no cabeçalho tem de ser o total do que passou no filtro. Contar antes
 * do filtro é o que fazia o cabeçalho dizer 12 sobre uma lista de 4.
 */
export function filaComLead<T extends ConversaParaFila>(conversas: T[]): T[] {
  return conversas
    .filter((c) => c.leadId !== null)
    .sort(
      (a, b) =>
        new Date(b.lastClientMessageAt).getTime() -
        new Date(a.lastClientMessageAt).getTime(),
    );
}

/**
 * Quantos dias faltam para um compromisso, em dias de CALENDÁRIO.
 *
 * Dias de calendário e não horas: às 23h de hoje, um compromisso das 8h de
 * amanhã está a nove horas — "0 dias" pela conta de horas, e "amanhã" para
 * qualquer pessoa olhando a agenda.
 *
 * `agora` é PARÂMETRO, não `new Date()` interno: é o que permite testar a
 * virada do dia, e é o que faz o card recalcular quando o dia vira em vez de
 * ficar presto ao instante em que a aba foi aberta.
 */
export function diasAte(
  inicio: Date,
  agora: Date,
): { dias: number; texto: string; hoje: boolean } {
  const soData = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((soData(inicio) - soData(agora)) / 86_400_000);

  if (dias <= 0) return { dias: Math.min(dias, 0), texto: "hoje", hoje: true };
  if (dias === 1) return { dias, texto: "amanhã", hoje: false };
  return { dias, texto: `${dias} dias`, hoje: false };
}
