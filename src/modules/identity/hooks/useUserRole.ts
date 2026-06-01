import { useQuery } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../auth/contexts/AuthContext";
import { useCurrentTeamMember } from "./useTeamMembers";
import { useMasterAuth } from "./useMasterAuth";
import type { Tables } from "@/integrations/supabase/types";

export type UserRole = Tables<"user_roles">;
export type AppRole = "admin" | "member";

/**
 * Determina o role efetivo do usuário.
 *
 * Fonte de verdade: team_members.role (conforme migration de sync e
 * deprecação de user_roles). Se team_members diz 'admin', o usuário
 * é admin — independente do estado de user_roles.
 *
 * Fallback: user_roles, para cobrir edge cases onde team_member
 * ainda não carregou ou não existe.
 */
export function useUserRole() {
  const { user } = useAuth();
  const { data: currentTeamMember } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["user_role", user?.id, currentTeamMember?.role],
    queryFn: async () => {
      if (!user?.id) return null;

      // team_members.role é a fonte de verdade
      if (currentTeamMember?.role) {
        return { user_id: user.id, role: currentTeamMember.role } as UserRole;
      }

      // Fallback: user_roles (para casos sem team_member carregado)
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user?.id,
  });
}

/**
 * @deprecated Use useIdentity().isAdmin instead.
 */
export function useIsAdmin() {
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  return {
    isAdmin: isMaster || userRole?.role === "admin",
    isLoading: roleLoading || masterLoading,
  };
}

export function useJobTitle() {
  const { data: currentTeamMember, isLoading } = useCurrentTeamMember();
  return {
    jobTitle: (currentTeamMember as any)?.job_title || "",
    isLoading,
  };
}

export function useMetricType(): { metricType: "meetings" | "sales"; isLoading: boolean } {
  const { data: currentTeamMember, isLoading } = useCurrentTeamMember();
  return {
    metricType: ((currentTeamMember as any)?.metric_type as "meetings" | "sales") || "meetings",
    isLoading,
  };
}

export function useHasRole(role: AppRole) {
  const { data: userRole, isLoading } = useUserRole();
  return {
    hasRole: userRole?.role === role,
    isLoading,
  };
}

/**
 * @deprecated Use useCanDo("manage_copilot") or individual feature keys.
 */
export function useCanManageCopilot() {
  const { allowed: canCreate, isLoading: l1 } = useFeaturePermission("copilot.create");
  const { allowed: canEdit,   isLoading: l2 } = useFeaturePermission("copilot.edit");
  const { allowed: canDelete, isLoading: l3 } = useFeaturePermission("copilot.delete");
  const { allowed: canToggle, isLoading: l4 } = useFeaturePermission("copilot.toggle");
  return {
    canManage: canCreate,
    canCreate,
    canEdit,
    canDelete,
    canToggle,
    isLoading: l1 || l2 || l3 || l4,
  };
}

/**
 * @deprecated Use useCanDo("whatsapp.manage_instances") instead.
 */
export function useCanManageWhatsApp() {
  const { allowed: canManage, isLoading } = useFeaturePermission("whatsapp.manage_instances");
  return { canManage, isLoading };
}

// ─── Feature Permissions Hook ───────────────────────────

interface FeaturePermissionsResponse {
  features: Record<string, boolean>;
  isAdmin: boolean;
  jobTitle: string;
  metricType: "meetings" | "sales";
}

/**
 * Busca todas as feature permissions do membro logado NA ORG ATUAL.
 *
 * Multi-tenant: `organization_id` é enviado explicitamente no body e faz
 * parte da queryKey. Sem isso, a edge function cai no "primeiro team_member
 * ativo" do usuário (ordem created_at) e avalia permissões contra a org
 * errada — bloqueando ou liberando indevidamente para usuários em múltiplas
 * orgs. Ver incidente 2026-04-23-funis-access-multi-org-rls.
 *
 * Erros NÃO são silenciados (retornavam {}). Propagados via `isError` da
 * query, para o PermissionProtectedRoute diferenciar falha técnica de
 * "sem permissão" e oferecer retry em vez de Lock definitivo.
 * Incidente 2026-04-24 — membros com tela bloqueada pós PR #87.
 */
export function useFeaturePermissions() {
  const { user } = useAuth();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const { isMaster } = useMasterAuth();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["feature-permissions", user?.id, organizationId, isMaster],
    queryFn: async (): Promise<Record<string, boolean>> => {
      // Master bypassa permission checks via useFeaturePermission.allowed.
      // Não precisa chamar edge function — evita 500 quando shadow user
      // está em org sem team_member real. Incidente 2026-04-24.
      if (isMaster) return {};

      if (!user?.id) throw new Error("feature-permissions: usuário ausente");
      if (!organizationId) throw new Error("feature-permissions: organization_id ausente");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("feature-permissions: sessão sem token");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const res = await fetch(
        `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-member-permissions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            "X-User-JWT": session.access_token,
          },
          body: JSON.stringify({ organization_id: organizationId }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(
          `get-member-permissions ${res.status}: ${body.slice(0, 200)}`,
        );
        // Telemetria Fase 3: toda falha de get-member-permissions é sinal
        // forte de regressão em permissões (causa raiz do incidente 2026-04-24).
        // Capturar com contexto pra alertas e dashboards Sentry.
        Sentry.captureException(err, {
          tags: {
            feature: "permissions",
            kind: "get-member-permissions-http-error",
          },
          extra: {
            status: res.status,
            organizationId,
            userId: user.id,
          },
        });
        throw err;
      }

      const data = (await res.json()) as FeaturePermissionsResponse;
      return data.features || {};
    },
    enabled: !!user?.id && !!organizationId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * @deprecated Use useCanDo(featureKey) instead.
 */
export function useFeaturePermission(
  featureKey: string,
): { allowed: boolean; isLoading: boolean; hasError: boolean } {
  const { isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { data: features, isLoading: featuresLoading, isError } = useFeaturePermissions();
  const { isAdmin } = useIsAdmin();
  const { isMaster } = useMasterAuth();

  return {
    allowed: isMaster || isAdmin || features?.[featureKey] === true,
    isLoading: teamMemberLoading || featuresLoading,
    hasError: isError,
  };
}

