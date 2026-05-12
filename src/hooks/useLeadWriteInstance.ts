/**
 * useLeadWriteInstance — frontend resolver para "qual instância de escrita
 * pertence ao lead, e o user atual pode usá-la?".
 *
 * Consome RPC `get_lead_write_instance(p_lead_id)` (Etapa A) e cruza com:
 *   - useCurrentTeamMember() → identidade do user na org
 *   - useIsAdmin() / useMasterAuth() → bypass de admin/master
 *
 * Resultado tipado em LeadWriteInstanceState para o ChatComposerShell
 * decidir entre Estado 1 (HABILITADO), Estado 2 (BLOQUEADO_INSTANCIA_ALHEIA)
 * ou Estado 3 (ERRO_SEM_INSTANCIA / NO_RESPONSIBLE).
 *
 * Quando flag `user_write_instance_strict` está OFF, o estado retornado
 * continua sendo "ok / canWrite=true" para qualquer member com lead resolvido —
 * o backend é a fonte de verdade do bloqueio. Esta camada só ALIMENTA a UI
 * com semântica suficiente para mostrar a mensagem certa quando a UI
 * é ativada.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserWriteInstanceFlag } from "@/hooks/useUserWriteInstanceFlag";
import type {
  GetLeadWriteInstanceResult,
  WriteInstanceErrorCode,
} from "@/types/user-write-instance";

export type LeadWriteInstanceState =
  | { status: "loading" }
  | {
      status: "ok";
      instanceId: string;
      instanceName: string;
      ownerTeamMemberId: string | null;
      responsibleUserId: string;
      isOwn: boolean;
      canWrite: boolean;
      ownerName?: string;
      ownerFirstName?: string;
    }
  | {
      status: "error";
      errorCode: WriteInstanceErrorCode;
      responsibleUserId: string | null;
      ownerName?: string;
      ownerFirstName?: string;
      responsibleName?: string;
      responsibleFirstName?: string;
    };

interface UseLeadWriteInstanceResult {
  state: LeadWriteInstanceState;
  isLoading: boolean;
  refetch: () => void;
}

function firstName(fullName: string | null | undefined): string | undefined {
  if (!fullName) return undefined;
  const trimmed = fullName.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

export function useLeadWriteInstance(
  leadId: string | null | undefined,
): UseLeadWriteInstanceResult {
  const { organizationId } = useOrganization();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const { isAdmin } = useIsAdmin();
  const { isMaster } = useMasterAuth();
  const { isStrict, isLoading: flagLoading } = useUserWriteInstanceFlag();

  // 1. RPC: resolve instance + error code.
  //    Só dispara quando flag ON. Com flag OFF (default), curto-circuito devolve
  //    estado "ok / canWrite=true" — preserva legado byte-a-byte e evita
  //    chamar RPC inexistente em ambientes onde a migration A ainda não rodou.
  const rpcEnabled = !!leadId && !!organizationId && isStrict;
  const rpcQuery = useQuery({
    queryKey: ["lead-write-instance", organizationId, leadId],
    queryFn: async (): Promise<GetLeadWriteInstanceResult | null> => {
      if (!leadId) return null;
      // RPC `get_lead_write_instance` adicionada na migration 20260930000000.
      // Types.ts ainda não regen — cast preservando contrato de
      // GetLeadWriteInstanceResult definido em src/types/user-write-instance.ts.
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc("get_lead_write_instance", {
        p_lead_id: leadId,
      });
      if (error) throw error;
      // RPC returns a TABLE row; supabase-js wraps in array.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return {
          instance_id: null,
          instance_name: null,
          owner_team_member_id: null,
          responsible_user_id: null,
          error_code: "LEAD_NOT_FOUND",
        };
      }
      return row as GetLeadWriteInstanceResult;
    },
    enabled: rpcEnabled,
    staleTime: 30 * 1000,
    // Fail-safe: erro de RPC (ex: função inexistente) NÃO bloqueia composer.
    // O backend é a fonte de verdade do bloqueio — UI degrada para legado.
    retry: false,
  });

  // 2. Lookup auxiliar: nome do owner (Estado 2) e do responsável (Estado 3).
  //    Único query batch — pega ambos os IDs em uma chamada quando presentes.
  const ownerId = rpcQuery.data?.owner_team_member_id ?? null;
  const responsibleId = rpcQuery.data?.responsible_user_id ?? null;
  const idsToLookup = [ownerId, responsibleId].filter(
    (v): v is string => !!v && !v.startsWith("master-virtual-"),
  );

  const namesQuery = useQuery({
    queryKey: ["team-member-names", organizationId, idsToLookup.sort().join(",")],
    queryFn: async (): Promise<Record<string, string>> => {
      if (idsToLookup.length === 0 || !organizationId) return {};
      const { data, error } = await supabase
        .from("team_members")
        .select("id, name")
        .eq("organization_id", organizationId)
        .in("id", idsToLookup);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.id && row.name) map[row.id] = row.name;
      }
      return map;
    },
    enabled: idsToLookup.length > 0 && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Compose state ───────────────────────────────────────────────────────
  const isLoading =
    rpcQuery.isLoading ||
    (idsToLookup.length > 0 && namesQuery.isLoading);

  if (!leadId) {
    return {
      state: { status: "loading" },
      isLoading: false,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  // Flag OFF (default) ou erro de RPC → degrada para Estado 1 (HABILITADO):
  // canWrite=true, isOwn=true. Backend permanece a fonte de verdade do bloqueio.
  // Garante zero regressão visual antes do cutover por org.
  if (!isStrict || rpcQuery.isError) {
    const myTeamMemberId = currentTeamMember?.id ?? null;
    return {
      state: {
        status: "ok",
        instanceId: "",
        instanceName: "",
        ownerTeamMemberId: myTeamMemberId,
        responsibleUserId: myTeamMemberId ?? "",
        isOwn: true,
        canWrite: true,
      },
      isLoading: flagLoading,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  if (rpcQuery.isLoading || rpcQuery.isPending) {
    return {
      state: { status: "loading" },
      isLoading: true,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  const row = rpcQuery.data;
  if (!row) {
    return {
      state: { status: "loading" },
      isLoading,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  const namesMap = namesQuery.data ?? {};
  const ownerName = ownerId ? namesMap[ownerId] : undefined;
  const responsibleName = responsibleId ? namesMap[responsibleId] : undefined;

  // Error path — RPC returned error_code.
  if (row.error_code) {
    return {
      state: {
        status: "error",
        errorCode: row.error_code as WriteInstanceErrorCode,
        responsibleUserId: row.responsible_user_id,
        ownerName,
        ownerFirstName: firstName(ownerName),
        responsibleName,
        responsibleFirstName: firstName(responsibleName),
      },
      isLoading,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  // Success path — instance resolved.
  if (!row.instance_id || !row.instance_name || !row.responsible_user_id) {
    // Defensive: RPC contract says these are non-null when error_code is null.
    // If somehow null, treat as NO_INSTANCE so UI degrades gracefully.
    return {
      state: {
        status: "error",
        errorCode: "NO_INSTANCE",
        responsibleUserId: row.responsible_user_id,
        responsibleName,
        responsibleFirstName: firstName(responsibleName),
      },
      isLoading,
      refetch: () => {
        rpcQuery.refetch();
      },
    };
  }

  const myTeamMemberId = currentTeamMember?.id ?? null;
  const isOwn =
    !!myTeamMemberId &&
    !!row.owner_team_member_id &&
    row.owner_team_member_id === myTeamMemberId;
  const canWrite = isOwn || isAdmin || isMaster;

  return {
    state: {
      status: "ok",
      instanceId: row.instance_id,
      instanceName: row.instance_name,
      ownerTeamMemberId: row.owner_team_member_id,
      responsibleUserId: row.responsible_user_id,
      isOwn,
      canWrite,
      ownerName,
      ownerFirstName: firstName(ownerName),
    },
    isLoading,
    refetch: () => {
      rpcQuery.refetch();
    },
  };
}
