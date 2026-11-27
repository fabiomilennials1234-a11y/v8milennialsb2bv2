/**
 * Tipos do diálogo de agendamento, fora do componente: o barrel e o
 * `CreateMeetingDialog` precisam deles sem puxar o diálogo (que importa
 * pipelines e leads) para o grafo estático.
 */
export type TipoAgendamento = "reuniao" | "contato";

/** O que só o formulário novo entende (o formulário de sempre ignora). */
export interface AgendamentoExtras {
  /** Tipos que a pessoa pode marcar. Com um só, o seletor some. */
  tipos?: TipoAgendamento[];
  /**
   * Marcar o próximo contato (só para `tipos` com "contato"). `leadPhoneId` é
   * o contato escolhido (`lead_phones.id`); `null` quando o cliente não tem.
   */
  onMarcarContato?: (input: { leadId: string; dia: string; observacao: string | null; leadPhoneId: string | null }) => Promise<unknown>;
}
