import { formatPhoneBR } from "@/shared/format/phone";

/**
 * Telefones do lead, cada um com o nome do contato (Chamado 82c50502, ADR-0039).
 *
 * `leads.phone` continua sendo o principal; `lead_phones` espelha o principal e
 * guarda os demais. "Contato" na tela é o agrupamento por `label` dentro do
 * lead — não existe tabela de pessoa (97% dos contatos nomeados do ERP têm um
 * telefone só).
 */
export interface LeadPhone {
  id: string;
  phone: string;
  normalizedPhone: string | null;
  label: string | null;
  labelLocked: boolean;
  isPrimary: boolean;
  isWhatsApp: boolean | null;
  source: "crm" | "erp";
}

export interface LeadPhoneRow {
  id: string;
  phone: string;
  normalized_phone: string | null;
  label: string | null;
  label_locked: boolean;
  is_primary: boolean;
  is_whatsapp: boolean | null;
  source: string;
}

export function leadPhoneFromRow(row: LeadPhoneRow): LeadPhone {
  return {
    id: row.id,
    phone: row.phone,
    normalizedPhone: row.normalized_phone,
    label: row.label,
    labelLocked: row.label_locked,
    isPrimary: row.is_primary,
    isWhatsApp: row.is_whatsapp,
    source: row.source === "erp" ? "erp" : "crm",
  };
}

/** Principal primeiro, depois por nome do contato, sem nome por último. */
export function ordenarTelefones(phones: LeadPhone[]): LeadPhone[] {
  return [...phones].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (!a.label !== !b.label) return a.label ? -1 : 1;
    return (a.label ?? "").localeCompare(b.label ?? "", "pt-BR");
  });
}

/** "José Luiz - Compras · (17) 98125-7650" — ou só o número, sem nome. */
export function rotuloDoTelefone(phone: Pick<LeadPhone, "label" | "phone">): string {
  const numero = formatPhoneBR(phone.phone);
  return phone.label ? `${phone.label} · ${numero}` : numero;
}

export interface ContatoDoLead {
  /** null = telefones sem nome de contato. */
  nome: string | null;
  telefones: LeadPhone[];
}

const chaveDoNome = (nome: string | null) =>
  (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Agrupa por nome do contato (normalizado: caixa e acento não separam a mesma
 * pessoa). O ERP manda "José Luiz - Compras" com fixo e celular: é UM contato
 * com dois telefones. Grupo do principal primeiro; sem nome por último.
 */
export function agruparPorContato(phones: LeadPhone[]): ContatoDoLead[] {
  const grupos = new Map<string, ContatoDoLead>();
  for (const p of ordenarTelefones(phones)) {
    const chave = chaveDoNome(p.label);
    const g = grupos.get(chave);
    if (g) g.telefones.push(p);
    else grupos.set(chave, { nome: p.label, telefones: [p] });
  }
  return [...grupos.values()].sort((a, b) => {
    const pa = a.telefones.some((t) => t.isPrimary);
    const pb = b.telefones.some((t) => t.isPrimary);
    if (pa !== pb) return pa ? -1 : 1;
    if (!a.nome !== !b.nome) return a.nome ? -1 : 1;
    return 0;
  });
}

/**
 * Recusas das RPCs de telefone (mensagem curta do banco → texto da tela).
 * Nunca expõe o outro lead que já usa o número.
 */
const RECUSAS: Record<string, string> = {
  label_required: "Dê um nome ao contato do telefone novo",
  phone_invalid: "Telefone inválido — use DDD e número",
  phone_duplicated: "O mesmo telefone aparece duas vezes",
  primary_required: "Escolha o telefone principal",
  primary_duplicated: "Só um telefone pode ser o principal",
  lead_phone_invalid: "Este telefone não é mais deste lead. Atualize a ficha.",
  lead_phone_required: "Escolha com quem é este negócio",
  lead_not_found: "Lead não encontrado. Atualize a ficha.",
  sem_permissao_lead: "Você não pode editar este lead.",
  phone_compartilhado_sem_dono:
    "Não foi possível compartilhar: nenhum outro lead da organização mantém este número como principal.",
};

/** A frase da tela para uma recusa CONHECIDA das RPCs de telefone; `null` se não for uma. */
export function recusaDeTelefone(
  error: { code?: string; message?: string } | null | undefined,
): string | null {
  const msg = error?.message ?? "";
  if (RECUSAS[msg]) return RECUSAS[msg];
  // idx_leads_org_phone_unique: o número escolhido como principal já é o
  // principal de OUTRO lead da organização.
  if (error?.code === "23505") return PRINCIPAL_OCUPADO_GENERICO;
  return null;
}

const PRINCIPAL_OCUPADO_GENERICO = "Este número já é o principal de outro lead da organização";

/**
 * O número escolhido como principal já é o principal de OUTRO lead vivo da org
 * (`idx_leads_org_phone_unique`) — típico de cliente duplicado no ERP. Diz qual
 * lead segura o número; se o RLS não deixa o usuário ver esse lead (`null`),
 * mantém a frase genérica, sem vazar nada.
 */
export function mensagemDePrincipalOcupado(dono: DonoDoNumero | null | undefined): string {
  if (!dono) return PRINCIPAL_OCUPADO_GENERICO;
  return `Este número já é o principal do lead ${rotuloDoDono(dono)}. Tire-o de lá ou escolha outro número.`;
}

/** O lead que já segura o número, como o RLS do usuário deixa ver. */
export interface DonoDoNumero {
  name: string | null;
  erp_code: string | null;
}

/** "4545 - REFEICOES AO PONTO LTDA", ou só o nome sem código do ERP. */
function rotuloDoDono(dono: DonoDoNumero): string {
  const nome = dono.name?.trim() || "sem nome";
  return dono.erp_code ? `${dono.erp_code} - ${nome}` : nome;
}

/**
 * Pergunta do diálogo de confirmação (Chamado 99067f13, PR4): o número escolhido
 * como principal já é o principal de outro lead e o usuário pode COMPARTILHÁ-LO.
 * Dono invisível (RLS) → frase genérica, sem nome.
 */
export function mensagemDeCompartilharNumero(dono: DonoDoNumero | null | undefined): string {
  const quem = dono ? `do lead ${rotuloDoDono(dono)}` : "de outro lead da organização";
  return `Este número já é o principal ${quem}. Compartilhar o número entre os dois leads?`;
}

/** "Deixar de compartilhar" recusado: outro lead já é o dono do número. */
export function mensagemDeDescompartilharOcupado(dono: DonoDoNumero | null | undefined): string {
  const quem = dono ? `o lead ${rotuloDoDono(dono)}` : "outro lead da organização";
  return `Não dá para deixar de compartilhar: ${quem} já é o principal deste número. Tire-o de lá ou troque o número deste lead.`;
}

/**
 * O número escolhido como principal já é o principal de outro lead vivo
 * (`idx_leads_org_phone_unique`). A mensagem é a antiga (quem chama sem tratar
 * continua vendo a frase de #2331); a tela tipa o erro para oferecer o diálogo
 * "Compartilhar". `dono` é `null` quando o RLS esconde o outro lead.
 */
export class PrincipalOcupadoError extends Error {
  constructor(readonly dono: DonoDoNumero | null) {
    super(mensagemDePrincipalOcupado(dono));
    this.name = "PrincipalOcupadoError";
  }
}

/**
 * 23505 do índice do principal: o UPDATE em `leads` (a mensagem do Postgres
 * nomeia `idx_leads_org_phone_unique`) ou a recusa de `lead_phone_descompartilhar`
 * (`principal_ocupado`). Outro 23505 — `phone_duplicated` ou um índice que não é
 * o do principal — não vira oferta de compartilhar.
 */
export function ehPrincipalOcupado(error: { code?: string; message?: string } | null | undefined): boolean {
  if (error?.code !== "23505") return false;
  const msg = error.message ?? "";
  return msg === "principal_ocupado" || msg.includes("idx_leads_org_phone_unique");
}

export function mensagemDoErroDeTelefone(
  error: { code?: string; message?: string } | null | undefined,
  fallback = "Não foi possível salvar os telefones",
): string {
  return recusaDeTelefone(error) ?? fallback;
}

/**
 * O que a mutation lança: recusa conhecida vira a frase da tela; o resto sobe
 * ORIGINAL, para `toAppError` classificar, relatar e dar a referência
 * (ADR-0038). Embrulhar tudo num `Error` genérico apagava a causa — foi assim
 * que um "Não foi possível salvar os telefones" chegou sem pista nenhuma.
 */
export function erroDeTelefone(error: { code?: string; message?: string }): unknown {
  const recusa = recusaDeTelefone(error);
  return recusa ? new Error(recusa) : error;
}
