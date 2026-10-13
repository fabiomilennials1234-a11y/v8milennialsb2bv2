import type { LeadCardFieldGroup } from "./types";

const UTMS = [
  ["utm_source", "UTM Source"],
  ["utm_medium", "UTM Medium"],
  ["utm_campaign", "UTM Campaign"],
  ["utm_content", "UTM Content"],
  ["utm_term", "UTM Term"],
] as const;

/** Tracking vem da captura do lead, nunca de edição manual no painel. */
export function camposDeOrigemDaCampanha(lead: Record<string, unknown>): LeadCardFieldGroup[] {
  const campos = UTMS.map(([chave, rotulo]) => ({
    chave,
    rotulo,
    valor: typeof lead[chave] === "string" && lead[chave].trim() ? lead[chave] : null,
    somenteLeitura: true,
    tipo: "texto" as const,
  }));
  return campos.some(campo => campo.valor !== null)
    ? [{ titulo: "Origem da campanha", campos }]
    : [];
}
