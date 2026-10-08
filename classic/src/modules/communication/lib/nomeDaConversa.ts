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
import { withErpCode } from "@/shared/format/erp-code";

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
  /**
   * Flag por org `chat_nome_cod_contato_lead` (Chamado 82c50502): o nome é
   * `Cód - Contato - Lead` (ver `nomeCodContatoLead`). Vence as outras duas.
   * Ausente = comportamento de sempre.
   */
  nomeCodContatoLead?: boolean;
}

export interface FontesDoNomeCodContatoLead extends FontesDoNomeDaConversa {
  /** `leads.erp_code` do lead da conversa. */
  erpCode?: string | null;
  /** `lead_phones.label` do telefone DESTA conversa ("José Luiz - Compras"). */
  contato?: string | null;
}

/** Remove o código do ERP digitado no começo do nome ("6627 - Fernando"), com o mesmo separador frouxo de `withErpCode`. */
function semCodigoNoInicio(nome: string, codigo: string): string {
  if (!codigo) return nome;
  const escapado = codigo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return nome.replace(new RegExp(`^${escapado}\\s*[-–:]\\s*`), "").trim() || nome;
}

const comparavel = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A regra da flag `chat_nome_cod_contato_lead` (decisão do CTO, 08/10/2026),
 * UMA só para lista, cabeçalho e painel: **`Cód - Contato - Lead`**.
 *
 * - Sem nome de contato no telefone da conversa: `Cód - Lead`.
 * - Sem código: `Contato - Lead`.
 * - Código já digitado no nome do lead ("6627 - Fernando Porto") não se repete:
 *   o `withErpCode` existente é idempotente, e o contato entra DEPOIS do código.
 * - Contato igual ao nome do lead (caixa, acento e espaço não contam): não se
 *   repete.
 * - Conversa sem lead: a regra de `nomeComLeadPrimeiro`.
 *
 * Só exibição: nada disto é gravado em `leads.name` — disparo, Copilot e
 * `{{nome}}` seguem com o nome puro. Quem chama é responsável por NÃO usar isto
 * em grupo nem em canal que não seja WhatsApp.
 */
export function nomeCodContatoLead(fontes: FontesDoNomeCodContatoLead): string {
  const lead = fontes.nomeDoLead?.trim();
  if (!lead) return nomeComLeadPrimeiro(fontes);
  const codigo = (fontes.erpCode ?? "").trim();
  const contato = fontes.contato?.trim();
  const leadSemCodigo = semCodigoNoInicio(lead, codigo);
  if (!contato || comparavel(contato) === comparavel(leadSemCodigo) || comparavel(contato) === comparavel(lead)) {
    return withErpCode(lead, codigo);
  }
  return withErpCode(`${contato} - ${leadSemCodigo}`, codigo);
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
  fontes: FontesDoNomeCodContatoLead,
  opcoes: OpcoesDoNomeDaConversa = {},
): string {
  const { pushName, nomeDoLead } = fontes;
  if (opcoes.nomeCodContatoLead) return nomeCodContatoLead(fontes);
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
  /**
   * Flag `chat_nome_cod_contato_lead`: o painel mostra o MESMO nome do topo e
   * da lista (`nomeDaConversa` já resolvido por `nomeCodContatoLead`), e não o
   * `leads.name` cru.
   */
  nomeCodContatoLead?: boolean;
}): string {
  if (fontes.nomeCodContatoLead && fontes.nomeDaConversa?.trim()) return fontes.nomeDaConversa.trim();
  return (
    fontes.leadName?.trim() ||
    fontes.nomeDaConversa ||
    fontes.pushName ||
    fontes.telefoneExibicao ||
    "Contato"
  );
}
