/**
 * buildRecipients — Quick Blast recipient builder (Module B).
 *
 * Pure transform: selected leads + message template → normalized, deduped,
 * capped recipients, with a breakdown of who was dropped and why.
 */
import { normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { resolveBlastMessage } from "./message-resolver.ts";
import { personalizationName } from "../lead-name.ts";

export interface BlastLead {
  id: string;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  [key: string]: unknown;
}

export interface BlastRecipient {
  number: string;
  // Uazapi /sender/advanced requires a `type` on EVERY item — an item without
  // one is silently rejected (count=0 → empty campaign). "text" for plain text,
  // "image" for media blasts.
  type: "text" | "image";
  text?: string;
  leadId: string;
  file?: string;
  caption?: string;
}

export interface BuildRecipientsResult {
  recipients: BlastRecipient[];
  skipped: { noPhone: number; duplicates: number; overCap: number };
}

export function buildRecipients(
  leads: BlastLead[],
  opts: { template: string; cap: number; rng?: () => number; imageUrl?: string },
): BuildRecipientsResult {
  const skipped = { noPhone: 0, duplicates: 0, overCap: 0 };
  const recipients: BlastRecipient[] = [];
  const seen = new Set<string>();

  for (const lead of leads) {
    const number = normalizeBrazilianPhone(lead.phone ?? null);
    if (!number) {
      skipped.noPhone += 1;
      continue;
    }
    if (seen.has(number)) {
      skipped.duplicates += 1;
      continue;
    }
    seen.add(number);
    if (recipients.length >= opts.cap) {
      skipped.overCap += 1;
      continue;
    }
    const text = resolveBlastMessage(opts.template, leadVars(lead), opts.rng);
    if (opts.imageUrl) {
      // Image blast: resolved text becomes the caption (Uazapi media shape).
      recipients.push({ number, leadId: lead.id, type: "image", file: opts.imageUrl, caption: text });
    } else {
      // Text blast: `type:"text"` is mandatory — Uazapi rejects items without it.
      recipients.push({ number, leadId: lead.id, type: "text", text });
    }
  }

  return { recipients, skipped };
}

function leadVars(lead: BlastLead): Record<string, string | number | null | undefined> {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const brl = (v: unknown): string => {
    const n = num(v);
    return n === null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };
  const safeName = personalizationName(lead.name);
  return {
    // Always available (from leads) — placeholder names ("WhatsApp 2952") blanked
    nome: safeName,
    primeiro_nome: safeName.trim().split(/\s+/)[0] ?? "",
    empresa: lead.company ?? "",
    // Carteira variables — present only when an upsell_clients row was joined.
    // Absent → empty string (resolver treats null as "").
    segmento: (lead.segment as string | null | undefined) ?? null,
    dias_sem_pedido: num(lead.days_since_last_order),
    ticket_medio: brl(lead.avg_ticket),
    ltv: brl(lead.lifetime_value),
  };
}
