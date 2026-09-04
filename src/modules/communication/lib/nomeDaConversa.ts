/**
 * O nome que a conversa exibe no CABEÇALHO (desktop e mobile).
 *
 * Duas ordens, escolhidas por org via a flag `chat_nome_do_whatsapp`:
 *
 * - **padrão** — `nome do lead → push_name → telefone`. O nome curado pelo CRM
 *   manda. É o que ~30 orgs veem hoje e o que continua valendo sem a flag.
 * - **com a flag** — `push_name → nome do lead → telefone`. Quem manda é o nome
 *   que a PESSOA escreveu no perfil do WhatsApp dela.
 *
 * Por que isso é uma escolha e não um bug: as duas fontes são legítimas e
 * divergem de propósito. O `push_name` é o que o interlocutor se chama — chega
 * em toda mensagem recebida e o trigger de `whatsapp_conversation_summary` o
 * sobrescreve (`COALESCE(EXCLUDED.last_push_name, s.last_push_name)`, o novo na
 * frente), então acompanha a pessoa trocar o nome no aparelho. O `leads.name` é
 * o que a organização decidiu chamar aquele contato — código interno, razão
 * social, apelido do time — e só muda quando alguém edita.
 *
 * A LISTA (`contactLabel`) já resolve `push_name → lead_name → telefone` para
 * todas as orgs. A flag existe porque o cabeçalho fazia o inverso, e as duas
 * telas mostravam nomes diferentes para a MESMA conversa (relatado em 02/09).
 *
 * `??` e não `||`, dos dois lados: preserva byte-a-byte o que `ChatShellWithContext`
 * fazia antes desta função existir. String vazia é valor presente e continua
 * vencendo — trocar por `||` mudaria a tela de quem não pediu mudança.
 */

import { rotuloDeIdentificadorOculto } from "./identificadorOculto";

export interface FontesDoNomeDaConversa {
  /** `whatsapp_conversation_summary.last_push_name` — o perfil do interlocutor. */
  pushName: string | null;
  /** `leads.name` do lead efetivo (vínculo do contato, ou match por telefone). */
  nomeDoLead: string | null;
  telefone: string | null;
}

export interface OpcoesDoNomeDaConversa {
  /** Flag por org `chat_nome_do_whatsapp`. Ausente = comportamento de sempre. */
  nomeDoWhatsappPrimeiro?: boolean;
}

export function nomeDaConversa(
  fontes: FontesDoNomeDaConversa,
  opcoes: OpcoesDoNomeDaConversa = {},
): string {
  const { pushName, nomeDoLead } = fontes;
  // A ÚLTIMA queda deixa de ser o identificador cru: quando ele é um LID ou um
  // canal, o cabeçalho passava a se chamar `210028246085780`. Só a queda muda —
  // com nome de lead ou push_name, a ordem e o resultado são os de sempre.
  // Ver `lib/identificadorOculto.ts`.
  const telefone =
    rotuloDeIdentificadorOculto(fontes.telefone) ?? fontes.telefone;

  if (opcoes.nomeDoWhatsappPrimeiro) {
    return pushName ?? nomeDoLead ?? telefone ?? "";
  }

  return nomeDoLead ?? pushName ?? telefone ?? "";
}
