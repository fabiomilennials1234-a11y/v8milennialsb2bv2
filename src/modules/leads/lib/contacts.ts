import { isHumanPortugueseMessage } from "@/shared/errors";

/**
 * Contatos como entidade própria (Chamado 33c5fd52 · PR6).
 *
 * Um contato existe SEM lead e SEM empresa; o vínculo com leads é N:N
 * (`lead_contacts`). O banco é a fonte da regra (RPCs `contact_*` e
 * `lead_contact_*`); aqui vive o que o front controla: o formato do formulário,
 * a validação que poupa uma ida ao servidor, a leitura defensiva do jsonb de
 * `contact_list` e o texto das recusas.
 */

export const CONTACT_PAGE_SIZE = 50;
export const CONTACT_MAX_PHONES = 10;

export interface ContactPhone {
  id: string;
  phone: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactLeadLink {
  leadId: string;
  name: string;
  papel: string | null;
}

export interface Contact {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  createdAt: string;
  updatedAt: string;
  phones: ContactPhone[];
  leads: ContactLeadLink[];
}

export interface ContactList {
  total: number;
  rows: Contact[];
}

export interface PhoneInput {
  phone: string;
  label: string;
  isPrimary: boolean;
}

export interface ContactFormValues {
  name: string;
  email: string;
  jobTitle: string;
  phones: PhoneInput[];
  /** Só na criação: os leads vinculados no mesmo gesto. */
  leadIds: string[];
}

/** `type` (não `interface`): precisa ser atribuível a `Json` no argumento da RPC. */
export type PhonePayload = {
  phone: string;
  label: string | null;
  is_primary: boolean;
};

/** Linhas em branco saem; sobra um único principal (o marcado, senão o primeiro). */
export function buildPhonesPayload(phones: PhoneInput[]): PhonePayload[] {
  const limpos = phones
    .map((p) => ({ phone: p.phone.trim(), label: p.label.trim(), isPrimary: p.isPrimary }))
    .filter((p) => p.phone.length > 0);
  const idxPrincipal = Math.max(
    0,
    limpos.findIndex((p) => p.isPrimary),
  );
  return limpos.map((p, i) => ({
    phone: p.phone,
    label: p.label || null,
    is_primary: i === idxPrincipal,
  }));
}

export interface ContactFormErrors {
  name?: string;
  email?: string;
  /** Índice da linha (no formulário) -> mensagem. */
  phones?: Record<number, string>;
}

export function validateContactForm(values: ContactFormValues): ContactFormErrors {
  const errors: ContactFormErrors = {};
  if (values.name.trim().length === 0) errors.name = "Informe o nome do contato.";

  const email = values.email.trim();
  if (email.length > 0 && (email.indexOf("@") < 1 || email.length > 254)) errors.email = "E-mail inválido.";

  const phones: Record<number, string> = {};
  values.phones.forEach((p, i) => {
    const bruto = p.phone.trim();
    if (bruto.length === 0) return;
    const digitos = bruto.replace(/\D/g, "").length;
    if (digitos < 8 || digitos > 15) phones[i] = "Telefone inválido.";
  });
  if (Object.keys(phones).length > 0) errors.phones = phones;

  return errors;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lê o jsonb de `contact_list`; qualquer coisa fora do formato vira lista vazia. */
export function parseContactList(raw: unknown): ContactList {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return { total: 0, rows: [] };

  const rows: Contact[] = [];
  for (const r of raw.rows) {
    if (!isRecord(r) || typeof r.id !== "string") continue;
    const phones = Array.isArray(r.phones) ? r.phones : [];
    const leads = Array.isArray(r.leads) ? r.leads : [];
    rows.push({
      id: r.id,
      organizationId: str(r.organization_id) ?? "",
      name: str(r.name) ?? "",
      email: str(r.email),
      jobTitle: str(r.job_title),
      createdAt: str(r.created_at) ?? "",
      updatedAt: str(r.updated_at) ?? "",
      phones: phones.filter(isRecord).map((p) => ({
        id: str(p.id) ?? "",
        phone: str(p.phone) ?? "",
        label: str(p.label),
        isPrimary: p.is_primary === true,
      })),
      leads: leads.filter(isRecord).map((l) => ({
        leadId: str(l.lead_id) ?? "",
        name: str(l.name) ?? "",
        papel: str(l.papel),
      })),
    });
  }
  return { total: typeof raw.total === "number" ? raw.total : rows.length, rows };
}

const RECUSAS: Record<string, string> = {
  PT404: "Contato não encontrado. Atualize a lista.",
  PT422: "Confira os dados do contato.",
};

/**
 * Texto da recusa que o BANCO escreveu de propósito, ou `undefined` quando o
 * erro é outro (rede, 500, permissão genérica em inglês). A tela o passa como
 * `message` de `notifyError`; sem ele, cai no `fallback`.
 */
export function recusaDeContato(
  error: { code?: string; message?: string } | null | undefined,
): string | undefined {
  const code = error?.code;
  if (!code) return undefined;
  const fraseDoBanco =
    error?.message && isHumanPortugueseMessage(error.message) ? error.message : undefined;
  if (code === "42501") return fraseDoBanco;
  if (code === "PT422") return fraseDoBanco ?? RECUSAS.PT422;
  return RECUSAS[code];
}
