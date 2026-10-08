/**
 * message-preview — pure template resolver for the blast preview (#907).
 *
 * Renders the authored message as a sample Lead will receive it. Known
 * variables are replaced with the sample's values; {{primeiro_nome}} is the
 * first word of the name; any unknown or absent token renders as empty string
 * (no fallback) — the Template Variable rule from CONTEXT.md. Pure: same input
 * always yields the same preview, so the wizard can render it on every keystroke.
 */

import { personalizationFirstName } from "@/shared/format/first-name";

export interface PreviewSample {
  nome: string;
  empresa: string;
  segmento: string;
}

function valueFor(token: string, sample: PreviewSample): string {
  switch (token) {
    case "nome":
      return sample.nome;
    case "primeiro_nome":
      return personalizationFirstName(sample.nome);
    case "empresa":
      return sample.empresa;
    case "segmento":
      return sample.segmento;
    default:
      return ""; // unknown/absent → empty, no fallback
  }
}

export function resolvePreview(message: string, sample: PreviewSample): string {
  return message.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, token: string) =>
    valueFor(token, sample),
  );
}
