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
};

export function mensagemDoErroDeTelefone(
  error: { code?: string; message?: string } | null | undefined,
  fallback = "Não foi possível salvar os telefones",
): string {
  const msg = error?.message ?? "";
  if (RECUSAS[msg]) return RECUSAS[msg];
  // idx_leads_org_phone_unique: o número escolhido como principal já é o
  // principal de OUTRO lead da organização.
  if (error?.code === "23505") return "Este número já é o principal de outro lead da organização";
  return fallback;
}
