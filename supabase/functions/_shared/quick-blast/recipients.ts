/**
 * buildRecipients — Quick Blast recipient builder (Module B).
 *
 * Pure transform: selected leads + message template → normalized, deduped,
 * capped recipients, with a breakdown of who was dropped and why.
 */
import { normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { resolveBlastMessage } from "./message-resolver.ts";
import { personalizationName, personalizationFirstName } from "../lead-name.ts";
import type { BlastMedia } from "./blast-media.ts";

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
  // "image" / "document" (PDF, Word) for media blasts.
  type: "text" | "image" | "document";
  text?: string;
  leadId: string;
  file?: string;
  /** File name the lead sees — document items only (Uazapi `docName`). */
  docName?: string;
  /** Resolved message of a media item. runUazapiSenderJob moves it into `text`,
   *  the field the Uazapi spec names for the media caption. */
  caption?: string;
}

export interface BuildRecipientsResult {
  recipients: BlastRecipient[];
  skipped: { noPhone: number; duplicates: number; overCap: number };
}

export function buildRecipients(
  leads: BlastLead[],
  opts: {
    template: string;
    cap: number;
    rng?: () => number;
    /** Legacy image-only attachment. `media` wins when both are given. */
    imageUrl?: string;
    /** The Disparo attachment — image or document (Chamado dac7e647). */
    media?: BlastMedia | null;
  },
): BuildRecipientsResult {
  const media: BlastMedia | null =
    opts.media ?? (opts.imageUrl ? { type: "image", url: opts.imageUrl, name: null } : null);
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
    if (media?.type === "document") {
      // Document blast (PDF/Word): file + docName, resolved text as the caption.
      recipients.push({
        number,
        leadId: lead.id,
        type: "document",
        file: media.url,
        docName: media.name ?? fileNameFromUrl(media.url),
        caption: text,
      });
    } else if (media) {
      // Image blast: resolved text becomes the caption (Uazapi media shape).
      recipients.push({ number, leadId: lead.id, type: "image", file: media.url, caption: text });
    } else {
      // Text blast: `type:"text"` is mandatory — Uazapi rejects items without it.
      recipients.push({ number, leadId: lead.id, type: "text", text });
    }
  }

  return { recipients, skipped };
}

/** Last path segment — fallback only, for a document persisted without a name. */
function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return decodeURIComponent(last) || "documento";
  } catch {
    return "documento";
  }
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
    primeiro_nome: personalizationFirstName(lead.name),
    empresa: lead.company ?? "",
    // Carteira variables — present only when an upsell_clients row was joined.
    // Absent → empty string (resolver treats null as "").
    segmento: (lead.segment as string | null | undefined) ?? null,
    dias_sem_pedido: num(lead.days_since_last_order),
    ticket_medio: brl(lead.avg_ticket),
    ltv: brl(lead.lifetime_value),
  };
}
