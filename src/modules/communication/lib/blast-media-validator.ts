/**
 * blast-media-validator — pure kind/size guard for blast media (PRD #900, #903).
 *
 * A blast carries at most one media attachment (v1). WhatsApp/Uazapi impose
 * practical size ceilings per kind; oversized files must be blocked at upload
 * with a clear message rather than failing mid-blast. This module is the pure,
 * IO-free decision: which kind a file is (or that the Disparo cannot carry it),
 * and whether its size fits that kind's limit so the UI can say "máx N MB".
 *
 * What the Disparo carries (Chamado dac7e647): an image, or a document — PDF or
 * Word. Audio and video are refused up front: the blast backend does not send
 * them, and accepting them on screen would drop them in silence.
 */

export type BlastMediaType = "image" | "document";

/** Per-type upload ceilings in megabytes. */
export const BLAST_MEDIA_LIMITS_MB: Record<BlastMediaType, number> = {
  image: 5,
  document: 20,
};

/** Shown for anything the Disparo cannot send (audio, video, spreadsheet…). */
export const BLAST_MEDIA_UNSUPPORTED = "Por enquanto o disparo envia imagem, PDF ou Word.";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Document extensions → the MIME the upload declares (the bucket allowlist
 *  matches on it, and some browsers report no MIME for Word files). */
const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: DOCX_MIME,
};
const DOCUMENT_MIMES = new Set(Object.values(DOCUMENT_MIME_BY_EXTENSION));

/** The file picker's `accept`: images, PDF and Word (extensions + MIMEs). */
export const BLAST_MEDIA_ACCEPT = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ...DOCUMENT_MIMES,
].join(",");

export type BlastMediaClassification =
  | { ok: true; type: BlastMediaType; contentType: string }
  | { ok: false; error: string };

/**
 * Which kind of Disparo attachment a file is, and the content type to upload it
 * with. MIME first; the extension decides when the browser reports none (or a
 * generic octet-stream), which happens with Word files on machines without Office.
 */
export function classifyBlastMedia(file: { name: string; type: string }): BlastMediaClassification {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return { ok: true, type: "image", contentType: mime };
  if (DOCUMENT_MIMES.has(mime)) return { ok: true, type: "document", contentType: mime };

  if (mime === "" || mime === "application/octet-stream") {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const byExtension = DOCUMENT_MIME_BY_EXTENSION[ext];
    if (byExtension) return { ok: true, type: "document", contentType: byExtension };
  }
  return { ok: false, error: BLAST_MEDIA_UNSUPPORTED };
}

export type BlastMediaValidation =
  | { ok: true }
  | { ok: false; error: string; maxMb: number };

export function validateBlastMedia(
  type: BlastMediaType,
  sizeBytes: number,
): BlastMediaValidation {
  const maxMb = BLAST_MEDIA_LIMITS_MB[type];
  if (maxMb === undefined) {
    return { ok: false, error: BLAST_MEDIA_UNSUPPORTED, maxMb: 0 };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "Arquivo vazio ou inválido.", maxMb };
  }
  if (sizeBytes > maxMb * 1024 * 1024) {
    return {
      ok: false,
      error: `Arquivo muito grande — máximo ${maxMb} MB.`,
      maxMb,
    };
  }
  return { ok: true };
}
