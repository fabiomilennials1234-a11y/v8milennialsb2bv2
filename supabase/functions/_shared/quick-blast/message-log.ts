/**
 * buildBlastLogRows — per-lead conversation logging for Quick Blast (Slice 5).
 *
 * Turns dispatched recipients into outbound `channel_messages` rows so the rep
 * sees what was sent and the Copilot has context if the lead replies. Pure;
 * the IO insert lives in the caller. Written optimistically at enqueue — the
 * actual send happens asynchronously on Uazapi's side.
 */
import type { BlastRecipient } from "./recipients.ts";

export interface BlastLogRow {
  organization_id: string;
  lead_id: string;
  direction: "outbound";
  channel: "whatsapp";
  content: string;
  sender_name: string;
  metadata: Record<string, unknown>;
}

export function buildBlastLogRows(opts: {
  orgId: string;
  userId: string;
  senderJobId: string;
  recipients: BlastRecipient[];
}): BlastLogRow[] {
  const rows: BlastLogRow[] = [];
  for (const r of opts.recipients) {
    if (!r.leadId) continue; // cannot attach to a conversation without a lead
    const metadata: Record<string, unknown> = {
      source: "quick_blast",
      sender_job_id: opts.senderJobId,
    };
    if (r.file) {
      const mediaType = r.type === "document" ? "document" : "image";
      metadata.media_url = r.file;
      metadata.media_type = mediaType;
      // Legacy readers look for image_url — kept for images, never for documents.
      if (mediaType === "image") metadata.image_url = r.file;
      if (r.docName) metadata.media_name = r.docName;
    }
    rows.push({
      organization_id: opts.orgId,
      lead_id: r.leadId,
      direction: "outbound",
      channel: "whatsapp",
      content: r.text ?? r.caption ?? "",
      sender_name: opts.userId,
      metadata,
    });
  }
  return rows;
}
