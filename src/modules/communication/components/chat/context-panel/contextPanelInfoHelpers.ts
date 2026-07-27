/**
 * Helpers puros do ContextPanelTabInfo — resolução de responsável (id → membro)
 * e rótulo de tier de qualificação. Fora do componente pra serem testáveis sem
 * montar o painel inteiro (que depende de 5+ hooks).
 */
import { QUALIFICATION_TIER_CONFIG, type QualificationTier } from "@/modules/leads";

export type ResponsibleMember = { id: string; name: string; avatar_url?: string | null };

/** Membro pelo id, ou null. */
export function memberById(
  members: ResponsibleMember[],
  id: string | null | undefined,
): ResponsibleMember | null {
  if (!id) return null;
  return members.find((m) => m.id === id) ?? null;
}

/** Nome do membro pelo id, ou null. */
export function memberName(
  members: ResponsibleMember[],
  id: string | null | undefined,
): string | null {
  return memberById(members, id)?.name ?? null;
}

/** Rótulo do tier de (pré-)qualificação, ou null se ausente/desconhecido. */
export function tierLabel(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return QUALIFICATION_TIER_CONFIG[tier as QualificationTier]?.label ?? null;
}
