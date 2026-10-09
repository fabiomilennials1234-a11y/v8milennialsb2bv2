/**
 * Responsável da linha do inbox — o DONO do lead, pronto para desenhar.
 *
 * A conversa não tem dono próprio (`whatsapp_conversations` não tem
 * `assigned_to`): quem responde por ela é o dono do lead, o par canônico
 * `sale_responsible_id ?? pre_sale_responsible_id` (ver `useLeadResponsibleMap`).
 *
 * Três estados, e a diferença entre eles é o que impede a linha de piscar:
 *  - `undefined` — não há o que afirmar (sem lead, dado ainda chegando ou falhou).
 *    A linha NÃO renderiza o segmento.
 *  - `null` — o lead existe, o dado chegou, e ninguém é dono. "Sem responsável".
 *  - objeto — o dono, com nome curto para a linha e completo para o tooltip.
 */
import type { EnrichmentStatus } from "@/modules/communication/lib/inboxEnrichment";

export interface ResponsavelDaLinha {
  /** "Primeiro S." — cabe na linha de 10,5 px sem roubar a etapa. */
  nome: string;
  /** Nome completo, para o tooltip. */
  nomeCompleto: string;
}

/**
 * "Maria da Silva Souza" → "Maria S.". Um nome só fica como está. Partículas
 * ("da", "de", "dos") nunca viram a inicial — a inicial é do ÚLTIMO sobrenome.
 */
export function nomeCurtoDoResponsavel(nomeCompleto: string): string {
  const partes = nomeCompleto.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const [primeiro] = partes;
  if (partes.length === 1) return primeiro;
  const ultimo = partes[partes.length - 1];
  return `${primeiro} ${ultimo.charAt(0).toLocaleUpperCase("pt-BR")}.`;
}

interface MembroComNome {
  id: string;
  name: string | null;
}

/**
 * Resolve o responsável de UMA linha.
 *
 * Membro não encontrado (saiu da org, id órfão) é "sem responsável": a linha
 * nunca mostra um uuid nem um nome em branco.
 */
export function resolverResponsavelDaLinha(args: {
  leadId: string | null | undefined;
  ownerByLead: ReadonlyMap<string, string | null>;
  ownerStatus: EnrichmentStatus;
  membros: ReadonlyMap<string, MembroComNome> | null;
}): ResponsavelDaLinha | null | undefined {
  const { leadId, ownerByLead, ownerStatus, membros } = args;
  if (!leadId) return undefined;
  if (ownerStatus !== "ready" || !membros) return undefined;
  // Lead fora do mapa com status pronto: não voltou na consulta (outra org,
  // apagado). Não há o que afirmar sobre ele.
  if (!ownerByLead.has(leadId)) return undefined;
  const ownerId = ownerByLead.get(leadId);
  if (!ownerId) return null;
  const nomeCompleto = membros.get(ownerId)?.name?.trim();
  if (!nomeCompleto) return null;
  return { nome: nomeCurtoDoResponsavel(nomeCompleto), nomeCompleto };
}
