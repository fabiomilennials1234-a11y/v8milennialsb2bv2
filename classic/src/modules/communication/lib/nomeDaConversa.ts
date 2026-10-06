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
  savedContactName?: string | null;
  /** `leads.name` do lead efetivo (vínculo do contato, ou match por telefone). */
  nomeDoLead: string | null;
  telefone: string | null;
}

export interface OpcoesDoNomeDaConversa {
  /** Flag por org `chat_nome_do_whatsapp`. Ausente = comportamento de sempre. */
  nomeDoWhatsappPrimeiro?: boolean;
  /**
   * Flag por org `chat_nome_do_lead`: o `leads.name` manda, em lista, topo e
   * painel (ver `nomeComLeadPrimeiro`). Vence `nomeDoWhatsappPrimeiro` se as
   * duas vierem. Ausente = comportamento de sempre.
   */
  nomeDoLeadPrimeiro?: boolean;
}

/**
 * A regra da flag `chat_nome_do_lead` (decisão do CTO, 06/10/2026), UMA só para
 * lista, cabeçalho e painel lateral: `leads.name` → nome salvo → perfil do
 * WhatsApp → identificador/telefone.
 *
 * Só `leads.name`, como está gravado: nada é montado a partir de campos
 * separados. Lead sem nome (vazio ou só espaços) ou ausente cai na ordem que a
 * lista já tinha. Quem chama é responsável por NÃO usar isto em grupo nem em
 * canal que não seja WhatsApp.
 */
export function nomeComLeadPrimeiro(fontes: FontesDoNomeDaConversa): string {
  const nome =
    fontes.nomeDoLead?.trim() ||
    fontes.savedContactName?.trim() ||
    fontes.pushName?.trim();
  if (nome) return nome;
  return (
    rotuloDeIdentificadorOculto(fontes.telefone) ?? (fontes.telefone || "").trim()
  );
}

export function nomeDaConversa(
  fontes: FontesDoNomeDaConversa,
  opcoes: OpcoesDoNomeDaConversa = {},
): string {
  const { pushName, nomeDoLead } = fontes;
  if (opcoes.nomeDoLeadPrimeiro) return nomeComLeadPrimeiro(fontes);
  if (fontes.savedContactName?.trim()) return fontes.savedContactName.trim();
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

/**
 * O nome que o painel lateral exibe. O `leads.name` do lead que o painel
 * resolveu manda (com trim: lead só com espaços não conta); depois o nome que
 * o cabeçalho já resolveu (`nomeDaConversa`, só com a flag `chat_nome_do_lead`),
 * o perfil, o telefone já formatado e, por fim, "Contato". Sem a flag
 * `nomeDaConversa` é `undefined` e a cadeia é a de sempre.
 */
export function nomeDoPainelDeContexto(fontes: {
  leadName?: string | null;
  nomeDaConversa?: string | null;
  pushName?: string | null;
  telefoneExibicao?: string | null;
}): string {
  return (
    fontes.leadName?.trim() ||
    fontes.nomeDaConversa ||
    fontes.pushName ||
    fontes.telefoneExibicao ||
    "Contato"
  );
}
