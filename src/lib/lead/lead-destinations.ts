/**
 * lead-destinations.ts — mapeamento de destinos de lead para tipos de pipeline.
 *
 * Extraído de src/components/chat/LeadDetailContent.tsx (Onda 3.1, C1).
 */

/** Mapeia o alias de destino (criação de lead) para o pipeline_type do banco. */
export const DEST_TO_PIPE_TYPE: Record<string, string> = {
  qualificacao: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

/** Conjunto de destinos que correspondem a funis padrão. */
export const STANDARD_DESTINATIONS = new Set(["qualificacao", "confirmacao", "propostas"]);

export function isStandardDestination(dest: string): boolean {
  return STANDARD_DESTINATIONS.has(dest);
}

export function getPipeTypeForDestination(dest: string): string | undefined {
  return DEST_TO_PIPE_TYPE[dest];
}
