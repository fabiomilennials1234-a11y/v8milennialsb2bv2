/**
 * The attachment part of the blast-plan-create body (Chamado dac7e647).
 *
 * Every supported attachment travels as media_url / media_type / media_name. An
 * image ALSO keeps `image_url`: a server still on the previous edge reads only
 * that field, so images keep working whatever order the deploy lands in.
 *
 * An attachment without a URL (upload still running, or never finished) refuses
 * the release: sending the Disparo as text-only would drop the file in silence —
 * the exact bug this Chamado is about.
 */
import type { BlastMediaType } from "@/modules/communication";
import type { DisparoMedia } from "./wizard-machine";

/** Same ceiling blast-plan-create enforces on media_name. */
export const DISPARO_MEDIA_NAME_MAX = 255;

export const ANEXO_PENDENTE = "Aguarde o anexo terminar de enviar.";

export interface DisparoMediaPayload {
  image_url?: string;
  media_url?: string;
  media_type?: BlastMediaType;
  media_name?: string;
}

export type DisparoMediaPayloadResult =
  | { ok: true; payload: DisparoMediaPayload }
  | { ok: false; error: string };

export function buildDisparoMediaPayload(media: DisparoMedia | null): DisparoMediaPayloadResult {
  if (!media) return { ok: true, payload: {} };
  if (!media.url) return { ok: false, error: ANEXO_PENDENTE };

  const payload: DisparoMediaPayload = {
    media_url: media.url,
    media_type: media.type,
    media_name: fitFileName(media.name),
  };
  return {
    ok: true,
    payload: media.type === "image" ? { image_url: media.url, ...payload } : payload,
  };
}

/** Printable, trimmed, at most 255 characters — keeping the extension, which is
 *  how WhatsApp on the lead's phone decides what opens the file. */
function fitFileName(name: string): string {
  const printable = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();
  if (printable.length <= DISPARO_MEDIA_NAME_MAX) return printable;
  const dot = printable.lastIndexOf(".");
  const ext = dot > 0 && printable.length - dot <= 10 ? printable.slice(dot) : "";
  return printable.slice(0, DISPARO_MEDIA_NAME_MAX - ext.length) + ext;
}
