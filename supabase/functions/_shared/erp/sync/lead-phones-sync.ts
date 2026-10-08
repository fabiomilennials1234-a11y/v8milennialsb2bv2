/**
 * Telefones do ERP → `lead_phones` (Chamado 82c50502, ADR-0039).
 *
 * Regra de ouro: **o ERP sugere, o CRM manda.**
 *
 *  - Telefone que o lead ainda não tem → INSERT `source='erp'`.
 *  - Linha `erp` com `label_locked = false` → o nome do contato acompanha o ERP.
 *  - Linha `crm` → só ganha o que está vazio (`erp_phone_id`, e o nome quando
 *    ninguém nomeou e não está travado).
 *  - Linha apagada (soft delete) → NÃO volta. O usuário tirou; o ERP não desfaz.
 *  - Nunca mexe em `is_primary`, nunca DELETE, nunca toca `leads.phone`.
 *
 * O casamento é por `erp_phone_id` (id da LINHA no Toth, inclusive em linha
 * apagada) e, sem ele, pelo número normalizado entre as linhas ativas.
 *
 * `planLeadPhoneOps` é puro (testado sem banco). `syncLeadPhonesFromErp` é o
 * adaptador: lê o estado em lote e aplica pela RPC `aplicar_telefones_do_erp`,
 * que repete as guardas no SQL — a decisão daqui pode ter envelhecido entre a
 * leitura e a escrita, a do banco não.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeBrazilianPhone } from "../phone.ts";
import type { CanonicalPhone } from "../types.ts";

export interface ExistingLeadPhone {
  lead_id: string;
  normalized_phone: string | null;
  label: string | null;
  label_locked: boolean;
  source: "crm" | "erp";
  erp_phone_id: string | null;
  deleted_at: string | null;
}

export type LeadPhoneOp =
  | {
      op: "insert";
      lead_id: string;
      phone: string;
      label: string | null;
      erp_phone_id: string | null;
      is_whatsapp: boolean | null;
    }
  | {
      op: "update";
      lead_id: string;
      normalized_phone: string;
      label?: string;
      erp_phone_id?: string;
    };

export function planLeadPhoneOps(
  leadId: string,
  existing: ExistingLeadPhone[],
  erpPhones: CanonicalPhone[],
): LeadPhoneOp[] {
  const ops: LeadPhoneOp[] = [];
  const rows = existing.filter((r) => r.lead_id === leadId);
  const takenIds = new Set(rows.map((r) => r.erp_phone_id).filter((v): v is string => !!v));
  const plannedNumbers = new Set<string>();

  for (const p of erpPhones) {
    const norm = normalizeBrazilianPhone(p.phone);
    if (!norm || plannedNumbers.has(norm)) continue;
    plannedNumbers.add(norm);

    const byId = p.erpPhoneId ? rows.find((r) => r.erp_phone_id === p.erpPhoneId) : undefined;
    // Linha do ERP que o usuário apagou: não ressuscita.
    if (byId?.deleted_at) continue;

    const active = rows.find((r) => !r.deleted_at && r.normalized_phone === norm);
    if (!active) {
      // Número apagado no CRM (sem id do ERP para casar): também não volta.
      if (rows.some((r) => r.deleted_at && r.normalized_phone === norm)) continue;
      ops.push({
        op: "insert",
        lead_id: leadId,
        phone: p.phone,
        label: p.label,
        // Id já usado por outra linha do lead (o ERP trocou o número da linha):
        // o número novo entra, sem roubar a chave da linha antiga.
        erp_phone_id: p.erpPhoneId && !takenIds.has(p.erpPhoneId) ? p.erpPhoneId : null,
        is_whatsapp: p.isWhatsApp,
      });
      if (p.erpPhoneId) takenIds.add(p.erpPhoneId);
      continue;
    }

    const patch: { label?: string; erp_phone_id?: string } = {};
    if (!active.erp_phone_id && p.erpPhoneId && !takenIds.has(p.erpPhoneId)) {
      patch.erp_phone_id = p.erpPhoneId;
      takenIds.add(p.erpPhoneId);
    }
    if (p.label && !active.label_locked && p.label !== active.label) {
      // `erp` acompanha o ERP; `crm` só é nomeado se ainda não tem nome.
      if (active.source === "erp" || !active.label) patch.label = p.label;
    }
    if (patch.label !== undefined || patch.erp_phone_id !== undefined) {
      ops.push({ op: "update", lead_id: leadId, normalized_phone: norm, ...patch });
    }
  }
  return ops;
}

/** Leads por leitura — o `in` do PostgREST vai na query string. */
const LEADS_PER_READ = 100;
/** Operações por chamada da RPC. */
const OPS_PER_CALL = 500;

export interface LeadPhonesSyncItem {
  leadId: string;
  phones: CanonicalPhone[];
}

export interface LeadPhonesSyncResult {
  inserted: number;
  updated: number;
  errors: string[];
}

export async function syncLeadPhonesFromErp(
  admin: SupabaseClient,
  organizationId: string,
  items: LeadPhonesSyncItem[],
): Promise<LeadPhonesSyncResult> {
  const result: LeadPhonesSyncResult = { inserted: 0, updated: 0, errors: [] };
  const relevant = items.filter((i) => i.leadId && i.phones.length > 0);

  for (let i = 0; i < relevant.length; i += LEADS_PER_READ) {
    const slice = relevant.slice(i, i + LEADS_PER_READ);
    const existing: ExistingLeadPhone[] = [];
    // Paginado: `.limit()` acima de 1000 corta em silêncio.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("lead_phones")
        .select("lead_id, normalized_phone, label, label_locked, source, erp_phone_id, deleted_at")
        .eq("organization_id", organizationId)
        .in("lead_id", slice.map((s) => s.leadId))
        .order("id")
        .range(from, from + 999);
      if (error) {
        result.errors.push(`lead_phones (leitura): ${error.message}`);
        break;
      }
      existing.push(...((data ?? []) as ExistingLeadPhone[]));
      if ((data ?? []).length < 1000) break;
    }

    const ops = slice.flatMap((s) => planLeadPhoneOps(s.leadId, existing, s.phones));
    for (let j = 0; j < ops.length; j += OPS_PER_CALL) {
      const { data, error } = await admin.rpc("aplicar_telefones_do_erp", {
        p_organization_id: organizationId,
        p_ops: ops.slice(j, j + OPS_PER_CALL),
      });
      if (error) {
        result.errors.push(`aplicar_telefones_do_erp: ${error.message}`);
        continue;
      }
      const applied = (data ?? {}) as { inserted?: number; updated?: number };
      result.inserted += applied.inserted ?? 0;
      result.updated += applied.updated ?? 0;
    }
  }
  return result;
}
