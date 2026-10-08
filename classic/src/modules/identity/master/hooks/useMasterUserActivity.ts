/**
 * Atividade dos usuários por organização (Master Admin).
 *
 * Fonte: RPC `master_org_user_activity`, que lê `auth.sessions` — tabela que
 * o client NUNCA alcança direto (GRANT só para `postgres`). O gate de master
 * vive dentro da própria RPC.
 *
 * ⚠️ Resolução do sinal é de ~1 HORA, não de minutos: o `jwt_exp` do projeto
 * é 3600s, então a sessão só se renova a cada ~58min com a aba aberta. Por
 * isso a janela mínima oferecida é 60min e o rótulo na UI é "ativo na última
 * hora" — nunca "online agora". Ver o cabeçalho da migration.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OrgUserActivityRow {
  organization_id: string;
  org_name: string;
  org_subscription_status: string;
  member_id: string | null;
  user_id: string | null;
  member_name: string | null;
  member_email: string | null;
  member_role: string | null;
  is_master: boolean;
  last_seen_at: string | null;
  is_online: boolean;
}

export interface OrgActivityMember {
  memberId: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  isMaster: boolean;
  lastSeenAt: string | null;
  isOnline: boolean;
}

export interface OrgActivityGroup {
  organizationId: string;
  orgName: string;
  subscriptionStatus: string;
  members: OrgActivityMember[];
  onlineCount: number;
  totalCount: number;
}

/** A RPC ainda não está nos types gerados (migration é aplicada à mão em prod). */
type RpcCaller = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * Erro que o PostgREST devolve quando a função não existe no banco — ou seja,
 * a migration ainda não foi aplicada. Vale distinguir para a tela conseguir
 * explicar isso em vez de mostrar um erro genérico.
 */
export function isMissingRpcError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = e.message ?? "";
  if (e.code === "PGRST202") return true;
  return (
    /master_org_user_activity/i.test(msg) &&
    /(does not exist|not find|schema cache)/i.test(msg)
  );
}

/** True quando a RPC recusou o chamador por não ser master. */
export function isAccessDeniedError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42501" || /access_denied/i.test(e.message ?? "");
}

/**
 * Agrupa as linhas planas da RPC por organização.
 *
 * Pura de propósito: a página chama dentro de `useMemo`, então trocar o filtro
 * de masters não refaz a query — só reagrupa o que já está em cache.
 */
export function groupByOrg(
  rows: OrgUserActivityRow[],
  { includeMasters }: { includeMasters: boolean },
): OrgActivityGroup[] {
  const byOrg = new Map<string, OrgActivityGroup>();

  for (const row of rows) {
    let group = byOrg.get(row.organization_id);
    if (!group) {
      group = {
        organizationId: row.organization_id,
        orgName: row.org_name,
        subscriptionStatus: row.org_subscription_status,
        members: [],
        onlineCount: 0,
        totalCount: 0,
      };
      byOrg.set(row.organization_id, group);
    }

    // Org sem nenhum membro ativo vem do LEFT JOIN com member_id NULL.
    if (!row.member_id) continue;
    // Masters ocupam assento em várias orgs; contá-los distorceria o "N de M"
    // que o próprio cliente vê na tela de Equipe.
    if (row.is_master && !includeMasters) continue;

    group.members.push({
      memberId: row.member_id,
      userId: row.user_id,
      name: row.member_name ?? "—",
      email: row.member_email,
      role: row.member_role,
      isMaster: row.is_master,
      lastSeenAt: row.last_seen_at,
      isOnline: row.is_online,
    });
    group.totalCount += 1;
    if (row.is_online) group.onlineCount += 1;
  }

  return Array.from(byOrg.values());
}

/**
 * Total de PESSOAS distintas com sinal na janela.
 *
 * Distinto de propósito: um usuário membro de 3 orgs aparece em 3 linhas, e
 * somar linhas o contaria 3 vezes. O contador global da barra e o resumo da
 * tela usam esta mesma função para nunca divergirem entre si.
 */
export function countDistinctOnlineUsers(
  rows: OrgUserActivityRow[],
  { includeMasters }: { includeMasters: boolean },
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.user_id || !row.is_online) continue;
    if (row.is_master && !includeMasters) continue;
    seen.add(row.user_id);
  }
  return seen.size;
}

/** Total de pessoas distintas com assento ativo (online ou não). */
export function countDistinctUsers(
  rows: OrgUserActivityRow[],
  { includeMasters }: { includeMasters: boolean },
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.user_id) continue;
    if (row.is_master && !includeMasters) continue;
    seen.add(row.user_id);
  }
  return seen.size;
}

export function useMasterUserActivity(
  windowMinutes: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    // A queryKey é compartilhada de propósito: o ping da barra superior e a
    // tela detalhada usam o MESMO cache, então são sempre um só fetch.
    queryKey: ["master-org-user-activity", windowMinutes],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<OrgUserActivityRow[]> => {
      const { data, error } = await (supabase.rpc as unknown as RpcCaller)(
        "master_org_user_activity",
        { p_window_minutes: windowMinutes },
      );
      if (error) throw error;
      return (data ?? []) as OrgUserActivityRow[];
    },
    // O sinal só se move a cada ~58min; 60s de refetch é folgado de sobra e
    // mantém a tela viva sem inventar precisão que o dado não tem.
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}
