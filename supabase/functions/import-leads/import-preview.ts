/**
 * Prévia da importação: em que grupo cada linha cai e o que a pessoa pode fazer com ele.
 *
 * Nada aqui grava. A prévia mostra os grupos; ao confirmar, a edge classifica DE NOVO
 * no servidor e aplica a decisão de cada linha só se ela ainda couber no grupo — o que
 * o navegador diz sobre o grupo nunca é usado.
 *
 * Desenho aprovado pelo CTO em 25/11/2026 (Café Jurerê, flag `importacao_previa`).
 */

import { sameCompanyName } from "../_shared/erp/sync/adopt-existing-leads.ts";
import { type ExistingLead, type ExistingLeads, isErpClient, phoneKey } from "./import-match.ts";

export type PreviewGroup =
  | "novo"
  | "cliente_erp"
  | "ja_lead"
  | "repetido"
  | "outra_empresa"
  | "sem_telefone"
  | "invalido";

export type RowAction = "criar" | "pular" | "atualizar" | "vincular" | "criar_compartilhado";

/** O que cada grupo aceita; o primeiro é o padrão. */
export const GROUP_ACTIONS: Record<PreviewGroup, readonly RowAction[]> = {
  novo: ["criar", "pular"],
  cliente_erp: ["pular", "vincular", "criar_compartilhado"],
  ja_lead: ["atualizar", "pular"],
  repetido: ["pular"],
  outra_empresa: ["pular", "criar_compartilhado"],
  sem_telefone: ["criar", "pular"],
  invalido: ["pular"],
};

export interface PreviewMatch {
  /** Quem já tem o número: um lead do CRM ou uma linha anterior da própria planilha. */
  origem: "crm" | "arquivo";
  /** Linha da planilha (origem "arquivo"). */
  row?: number;
  /** Só quando a pessoa enxerga o lead. */
  lead_id?: string;
  /** Nome do cadastro; `null` quando a pessoa não enxerga o lead. */
  label: string | null;
  erp_code?: string | null;
  /** Situação no ERP, código cru do Toth ("0" ativo, "1" inativo…); a tela traduz. */
  erp_situacao?: string | null;
  visible: boolean;
}

export interface PreviewRow {
  row: number;
  group: PreviewGroup;
  name: string;
  company?: string;
  phone?: string;
  /** Motivo, para o grupo "invalido". */
  reason?: string;
  match?: PreviewMatch;
}

export interface PreviewInput {
  row: number;
  name: string;
  company?: string;
  /** Telefone já formatado pela edge ("55"+DDD+número). */
  phone?: string;
  email?: string;
  /** Motivo da validação, quando a linha não passa. */
  invalid?: string | null;
}

function crmMatch(lead: ExistingLead): PreviewMatch {
  return {
    origem: "crm",
    lead_id: lead.id,
    label: lead.company?.trim() || lead.name?.trim() || null,
    erp_code: lead.erp_code,
    erp_situacao: lead.erp_situacao ?? null,
    visible: true,
  };
}

function rowLabel(r: PreviewInput): string {
  return r.company?.trim() || r.name.trim();
}

/**
 * Grupo de cada linha, na ordem da planilha.
 *
 * Telefone repetido no arquivo vale contra a PRIMEIRA linha que o trouxe: mesmo nome é
 * "repetido", nome diferente é "outra empresa". Telefone de um lead do CRM: cliente do
 * ERP sempre cai em "cliente_erp" (o nome da planilha raramente bate com a razão social);
 * fora do ERP, mesmo nome é "ja_lead" e nome diferente é "outra empresa".
 */
export function classifyRows(rows: PreviewInput[], existing: ExistingLeads): PreviewRow[] {
  const firstInFile = new Map<string, PreviewInput>();

  return rows.map((r) => {
    const base = { row: r.row, name: r.name, company: r.company, phone: r.phone };
    if (r.invalid) return { ...base, group: "invalido", reason: r.invalid };

    const key = phoneKey(r.phone);
    if (!key) {
      const mail = r.email?.toLowerCase().trim();
      const byMail = mail ? existing.byEmail.get(mail) : undefined;
      if (byMail) return { ...base, group: isErpClient(byMail) ? "cliente_erp" : "ja_lead", match: crmMatch(byMail) };
      return { ...base, group: "sem_telefone" };
    }

    const first = firstInFile.get(key);
    if (first) {
      return {
        ...base,
        group: sameCompanyName(r, first) ? "repetido" : "outra_empresa",
        match: { origem: "arquivo", row: first.row, label: rowLabel(first), visible: true },
      };
    }
    firstInFile.set(key, r);

    const owner = existing.byPhone.get(key);
    if (!owner) return { ...base, group: "novo" };
    if (isErpClient(owner)) return { ...base, group: "cliente_erp", match: crmMatch(owner) };
    return { ...base, group: sameCompanyName(r, owner) ? "ja_lead" : "outra_empresa", match: crmMatch(owner) };
  });
}

/**
 * Esconde nome, código, situação e link dos leads que a pessoa não enxerga (RLS dela). A prévia
 * diz só "já cadastrado na empresa" — o import não pode virar um jeito de ler cadastro.
 */
export function hideInvisible(rows: PreviewRow[], visibleLeadIds: Set<string>): PreviewRow[] {
  return rows.map((r) => {
    const m = r.match;
    if (!m || m.origem !== "crm" || (m.lead_id && visibleLeadIds.has(m.lead_id))) return r;
    return { ...r, match: { origem: "crm", label: null, erp_code: null, visible: false } };
  });
}

/** Ids de lead que a prévia precisa conferir na RLS da pessoa. */
export function matchedLeadIds(rows: PreviewRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.match?.lead_id ? [r.match.lead_id] : [])))];
}

export interface PlannedRow {
  group: PreviewGroup;
  action: RowAction;
  /** A decisão pedida não cabe mais no grupo (algo mudou desde a prévia). */
  mismatch: boolean;
  match?: PreviewMatch;
}

/**
 * Decisão de cada linha, a partir da classificação feita AGORA no servidor.
 * `decisions` vem do navegador e não é confiável: o que não for uma lista de
 * `{ row, action }` com ação permitida para o grupo vira "pular".
 */
export function planRows(rows: PreviewRow[], decisions: unknown): Map<number, PlannedRow> {
  const asked = new Map<number, unknown>();
  if (Array.isArray(decisions)) {
    for (const d of decisions) {
      if (d && typeof d === "object" && Number.isInteger((d as { row?: unknown }).row)) {
        asked.set((d as { row: number }).row, (d as { action?: unknown }).action);
      }
    }
  }

  const plan = new Map<number, PlannedRow>();
  for (const r of rows) {
    const allowed = GROUP_ACTIONS[r.group];
    const wanted = asked.get(r.row);
    if (wanted === undefined) {
      plan.set(r.row, { group: r.group, action: allowed[0], mismatch: false, match: r.match });
    } else if (typeof wanted === "string" && (allowed as readonly string[]).includes(wanted)) {
      plan.set(r.row, { group: r.group, action: wanted as RowAction, mismatch: false, match: r.match });
    } else {
      plan.set(r.row, { group: r.group, action: "pular", mismatch: true, match: r.match });
    }
  }
  return plan;
}

/** Contagem por grupo, para o resumo da prévia. */
export function countByGroup(rows: PreviewRow[]): Record<PreviewGroup, number> {
  const out: Record<PreviewGroup, number> = {
    novo: 0,
    cliente_erp: 0,
    ja_lead: 0,
    repetido: 0,
    outra_empresa: 0,
    sem_telefone: 0,
    invalido: 0,
  };
  for (const r of rows) out[r.group]++;
  return out;
}
