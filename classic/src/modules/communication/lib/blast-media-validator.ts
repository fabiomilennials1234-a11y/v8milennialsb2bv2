/**
 * blast-media-validator — pure size/type guard for blast media (PRD #900, #903).
 *
 * A blast carries at most one media attachment (v1). WhatsApp/Uazapi impose
 * practical size ceilings per kind; oversized files must be blocked at upload
 * with a clear message rather than failing mid-blast. This module is the pure,
 * IO-free decision: given a media kind and a byte size, accept or reject with
 * the kind's limit so the UI can say "máx N MB".
 */

export type BlastMediaType = "image" | "audio" | "video" | "pdf";

/** Per-type upload ceilings in megabytes. */
export const BLAST_MEDIA_LIMITS_MB: Record<BlastMediaType, number> = {
  image: 5,
  audio: 16,
  video: 16,
  pdf: 20,
};

export type BlastMediaValidation =
  | { ok: true }
  | { ok: false; error: string; maxMb: number };

export function validateBlastMedia(
  type: BlastMediaType,
  sizeBytes: number,
): BlastMediaValidation {
  const maxMb = BLAST_MEDIA_LIMITS_MB[type];
  if (maxMb === undefined) {
    return { ok: false, error: "Tipo de mídia não suportado.", maxMb: 0 };
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
