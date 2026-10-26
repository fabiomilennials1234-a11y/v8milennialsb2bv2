/**
 * Telefones extras do lead na importação de planilha.
 *
 * O lead tem vários telefones (`lead_phones`, ADR-0039). Na planilha, os números
 * vêm separados por vírgula na mesma célula: o primeiro "principal" vai em
 * `leads.phone` (celular antes de fixo) e os demais viram linhas de
 * `lead_phones`. Parsing espelhado de `src/modules/leads/lib/import-phones.ts`
 * (a edge não importa de `src/`).
 *
 * Regras de casa:
 *  - a edge roda com service_role, então grava só em `lead_phones` e nunca em
 *    `leads` (21 gatilhos); o principal já é espelhado pelo gatilho do lead;
 *  - importar NUNCA marca `phone_compartilhado` nem mexe no principal de outro
 *    lead: extra é telefone secundário deste lead, nada mais;
 *  - telefone extra sem nome (`label` nulo) — a planilha não diz com quem se fala.
 */

export const MAX_EXTRA_PHONES = 9;

export interface PhoneCell {
  primary?: string;
  extras: string[];
}

export function parsePhoneCell(raw: string | undefined | null): PhoneCell {
  if (!raw) return { extras: [] };

  let work = String(raw).trim();
  const dotted = work.replace(",", ".");
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(dotted)) {
    const num = Number(dotted);
    if (!isNaN(num) && num > 0) work = Math.round(num).toString();
  }

  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const chunk of work.split(/[/;,|\n]|\s+ou\s+|\s+e\s+/i)) {
    let digits = chunk.replace(/\D/g, "");
    if (!digits) continue;
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push(digits);
  }
  if (numbers.length === 0) return { extras: [] };

  const primary = [...numbers].sort((a, b) => b.length - a.length)[0];
  return {
    primary,
    extras: numbers.filter((n) => n !== primary).slice(0, MAX_EXTRA_PHONES),
  };
}

/**
 * Extras de uma linha, no formato de `leads.phone` ("55" + DDD + número):
 * os da própria célula `phone` (payload de outra origem, XLSX, n8n) somados aos
 * `extra_phones` que o navegador já separou. Nunca inclui o principal.
 */
export function extraPhonesOf(lead: { phone?: string; extra_phones?: unknown }): string[] {
  const cell = parsePhoneCell(lead.phone);
  if (!cell.primary) return [];

  const fromPayload = Array.isArray(lead.extra_phones)
    ? lead.extra_phones.flatMap((v) => {
        if (typeof v !== "string") return [];
        const c = parsePhoneCell(v);
        return c.primary ? [c.primary, ...c.extras] : [];
      })
    : [];

  const out: string[] = [];
  for (const digits of [...cell.extras, ...fromPayload]) {
    if (digits === cell.primary || out.includes(digits)) continue;
    out.push(digits);
    if (out.length >= MAX_EXTRA_PHONES) break;
  }
  return out.map((d) => `55${d}`);
}

/** Só os dígitos locais (sem 55), para comparar com o que já está gravado. */
function localDigits(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
}

// Só o que usamos do client — deixa o teste trocar o Supabase por um fake.
interface LeadPhonesClient {
  from(table: "lead_phones"): any;
}

export interface ExtraPhonesResult {
  added: number;
  failed: number;
}

/**
 * Grava os extras do lead. Pula o que o lead já tem (ativo) e engole só a
 * corrida do índice único `lead_phones_lead_numero_uq` (23505); qualquer outro
 * erro conta como falha — o lead já existe, então não derruba a linha.
 */
export async function saveExtraPhones(
  supabase: LeadPhonesClient,
  organizationId: string,
  leadId: string,
  extras: string[],
): Promise<ExtraPhonesResult> {
  const result: ExtraPhonesResult = { added: 0, failed: 0 };
  if (extras.length === 0) return result;

  const { data, error } = await supabase
    .from("lead_phones")
    .select("phone")
    .eq("lead_id", leadId)
    .is("deleted_at", null);
  if (error) {
    console.error("[import-leads] lead_phones (leitura) falhou", { leadId, error: error.message });
    result.failed = extras.length;
    return result;
  }

  const have = new Set<string>((data ?? []).map((r: { phone: string }) => localDigits(r.phone)));
  for (const phone of extras) {
    const local = localDigits(phone);
    if (have.has(local)) continue;
    have.add(local);

    const { error: insertError } = await supabase.from("lead_phones").insert({
      organization_id: organizationId,
      lead_id: leadId,
      phone,
      is_primary: false,
      source: "crm",
    });
    if (!insertError || insertError.code === "23505") {
      if (!insertError) result.added++;
      continue;
    }
    console.error("[import-leads] lead_phones (extra) falhou", { leadId, error: insertError.message });
    result.failed++;
  }
  return result;
}
