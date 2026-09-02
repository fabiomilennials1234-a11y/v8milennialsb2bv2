/**
 * De onde sai o `lead_name` de cada linha da lista do inbox.
 *
 * Duas origens, e a ordem entre elas não é preferência: é o que o servidor sabe
 * primeiro.
 *
 * 1. `lead_id` do resumo (`whatsapp_conversation_summary`) → nome lido de `leads`
 *    por id. É o vínculo que o banco afirma.
 * 2. Sem `lead_id`, o telefone normalizado → nome lido de `leads` por
 *    `normalized_phone`. `idx_leads_org_phone_unique` garante no máximo um lead
 *    vivo por telefone na org, então não há qual-dos-dois a decidir.
 *
 * É a MESMA queda que o cabeçalho da conversa já fazia via `useLeadByPhone`
 * (ver `resolveEffectiveLead`). Ter os dois lados resolvendo igual é o ponto:
 * cabeçalho e lista mostrando nomes diferentes para a mesma conversa foi o
 * defeito relatado em 02/09.
 *
 * O nome NUNCA vem do resumo — só o `lead_id` vem. É por isso que renomear o
 * lead aparece na lista sozinho, no refetch seguinte (20s), sem F5 e sem
 * invalidação manual.
 */

export interface ContatoParaNomear {
  lead_id: string | null;
  phone_number: string;
}

export interface FontesDeNome {
  /** `leads.name` por `leads.id`, para quem o resumo já vinculou. */
  porId: ReadonlyMap<string, string>;
  /** `leads.name` por `leads.normalized_phone`, para quem o resumo não vinculou. */
  porTelefone: ReadonlyMap<string, string>;
  /** `phone_number` cru da linha → `normalized_phone` que a RPC devolveu. */
  normalizadoPorTelefone: ReadonlyMap<string, string>;
}

/**
 * O nome do lead desta linha, ou `null` quando não há lead conhecido.
 *
 * `null` e não string vazia: quem rotula (`contactLabel`) precisa distinguir
 * "não tem lead" de "tem lead sem nome" para cair no `push_name` em vez de
 * desenhar uma linha sem título.
 */
export function nomeDoLeadNaLista(
  contato: ContatoParaNomear,
  fontes: FontesDeNome,
): string | null {
  if (contato.lead_id) return fontes.porId.get(contato.lead_id) ?? null;

  const normalizado = fontes.normalizadoPorTelefone.get(contato.phone_number);
  if (!normalizado) return null;

  return fontes.porTelefone.get(normalizado) ?? null;
}
