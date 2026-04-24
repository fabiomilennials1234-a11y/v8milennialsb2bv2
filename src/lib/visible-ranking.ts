import { isVirtualTeamMember } from "@/hooks/useTeamMembers";

export interface RankingEntry {
  id: string;
  role?: string;
  position: number;
}

/**
 * Filtra um ranking mantendo apenas membros visíveis da organização e
 * renumera as posições (1..N) para manter pódio, medalhas e listas coerentes.
 *
 * Três camadas defensivas:
 *  1. id precisa estar em `visibleMemberIds` (derivado de `org_visible_members`).
 *  2. role !== "master" (caso a RPC retorne entries com role master).
 *  3. id não pode ser virtual (`master-virtual-*` via isVirtualTeamMember).
 */
export function filterVisibleRanking<T extends RankingEntry>(
  ranking: T[] | undefined | null,
  visibleMemberIds: ReadonlySet<string>
): T[] {
  if (!ranking) return [];
  return ranking
    .filter((u) => visibleMemberIds.has(u.id))
    .filter((u) => u.role !== "master")
    .filter((u) => !isVirtualTeamMember(u.id))
    .map((u, i) => ({ ...u, position: i + 1 }));
}
