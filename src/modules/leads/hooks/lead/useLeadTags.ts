/**
 * useLeadTags — leitura de tags de um lead específico.
 *
 * Onda 3.1, C11. Read-only nesta onda; write permanece em /leads (Onda 3.2).
 * Os dados vêm do lead já carregado via useLeadMeta (incluído no select com join).
 * Este hook é uma extração de conveniência — não faz query extra.
 */

interface LeadTag {
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

/**
 * Extrai tags de um lead já carregado.
 * Uso: const tags = useLeadTags(lead?.lead_tags)
 */
export function useLeadTags(leadTags: unknown): LeadTag[] {
  if (!Array.isArray(leadTags)) return [];
  return leadTags as LeadTag[];
}
