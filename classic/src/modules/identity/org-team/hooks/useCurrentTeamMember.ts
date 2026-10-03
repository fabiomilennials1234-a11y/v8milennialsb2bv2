/**
 * Current team member + seleção de org (localStorage) + types de team_member.
 * Extraído de useTeamMembers.ts na slice 9.4a (arch-deepening) para quebrar o
 * ciclo useOrganization↔useTeamMembers: este módulo NÃO importa useOrganization
 * nem useTeamMembers. useOrganization passa a importar useCurrentTeamMember daqui.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useMasterAuth } from "../../master/hooks/useMasterAuth";
import { useGestor } from "../../gestor/hooks/useGestor";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type TeamMember = Tables<"team_members">;
export type TeamMemberInsert = TablesInsert<"team_members">;
export type TeamMemberUpdate = TablesUpdate<"team_members">;

/**
 * Detecta se um teamMemberId é virtual (shadow user: master OU gestor de portfólio).
 * IDs virtuais nunca devem ser usados em mutations com FK (ver fix `8f63435e` +
 * ADR-0021: o virtual member do Gestor também é UI-only, nunca persiste).
 */
export function isVirtualTeamMember(id: string | null | undefined): boolean {
  return !!id && (id.startsWith("master-virtual-") || id.startsWith("gestor-virtual-"));
}

// Chave no localStorage para org selecionada (org switcher)
const SELECTED_ORG_KEY = "selected_org_id";

export function getSelectedOrgId(): string | null {
  try {
    return localStorage.getItem(SELECTED_ORG_KEY);
  } catch {
    return null;
  }
}

export function setSelectedOrgId(orgId: string) {
  try {
    localStorage.setItem(SELECTED_ORG_KEY, orgId);
  } catch {
    // localStorage indisponível
  }
}

/**
 * Cria um team member virtual para um shadow user (master ou gestor de portfólio).
 * Não existe no banco — apenas no frontend para manter o fluxo de contexto.
 * O `id` virtual (`master-virtual-*` / `gestor-virtual-*`) NUNCA é persistido em FK
 * (ver `isVirtualTeamMember` + ADR-0021).
 */
function buildVirtualTeamMember(
  userId: string,
  organizationId: string,
  actor: "master" | "gestor" = "master",
): TeamMember {
  return {
    id: `${actor}-virtual-${userId}`,
    user_id: userId,
    organization_id: organizationId,
    name: actor === "gestor" ? "Gestor" : "Master",
    role: "admin",
    is_active: true,
    ote_base: null,
    ote_bonus: null,
    commission_mrr_percent: null,
    commission_projeto_percent: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as TeamMember;
}

// Hook to get the current user's team member record
// Suporta troca de org via localStorage (org switcher)
// Master users recebem um team member virtual (shadow user)
export function useCurrentTeamMember() {
  const { user } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { isGestor, isLoading: gestorLoading } = useGestor();

  return useQuery({
    queryKey: ["team_members", "current", user?.id, isMaster, isGestor],
    queryFn: async () => {
      if (!user?.id) {
        console.log("🔍 useCurrentTeamMember: Sem user.id");
        return null;
      }

      console.log("🔍 useCurrentTeamMember: Buscando team_member para user:", user.id, { isMaster });

      const storedOrgId = getSelectedOrgId();
      console.log("🔍 useCurrentTeamMember: storedOrgId:", storedOrgId);

      // Se tem org selecionada, buscar team_member dessa org
      if (storedOrgId) {
        const { data, error: storedOrgError } = await supabase
          .from("team_members")
          .select("*")
          .eq("user_id", user.id)
          .eq("organization_id", storedOrgId)
          .eq("is_active", true)
          .maybeSingle();

        if (storedOrgError) {
          console.error("❌ useCurrentTeamMember: Erro ao buscar com org selecionada:", storedOrgError);
        }

        if (data) {
          console.log("✅ useCurrentTeamMember: Resultado (org selecionada):", {
            organizationId: data.organization_id,
          });
          return data as TeamMember;
        }

        console.log("⚠️ useCurrentTeamMember: Nenhum team_member encontrado para org selecionada:", storedOrgId);

        // Master sem team_member nessa org: criar virtual member
        if (isMaster) {
          // Verificar se a org ainda existe
          const { data: orgExists } = await supabase
            .from("organizations")
            .select("id")
            .eq("id", storedOrgId)
            .maybeSingle();

          if (orgExists) {
            console.log("✅ useCurrentTeamMember: Master virtual (org selecionada):", { organizationId: storedOrgId });
            return buildVirtualTeamMember(user.id, storedOrgId);
          }
          // Org não existe mais, limpar e buscar outra
          console.log("⚠️ useCurrentTeamMember: Org não existe mais, limpando localStorage");
          localStorage.removeItem(SELECTED_ORG_KEY);
        } else if (isGestor) {
          // Gestor de Portfólio: virtual member SÓ se a org selecionada estiver
          // entre os vínculos (whitelist). A RLS já escopa gestor_organizations ao
          // próprio gestor, então uma linha para storedOrgId prova o vínculo.
          const { data: bound } = await supabase
            .from("gestor_organizations" as any)
            .select("organization_id")
            .eq("organization_id", storedOrgId)
            .maybeSingle();

          if (bound) {
            console.log("✅ useCurrentTeamMember: Gestor virtual (org vinculada):", { organizationId: storedOrgId });
            return buildVirtualTeamMember(user.id, storedOrgId, "gestor");
          }
          // Org não vinculada ao gestor: limpar e cair no hub.
          console.log("⚠️ useCurrentTeamMember: Gestor sem vínculo com a org selecionada, limpando localStorage");
          localStorage.removeItem(SELECTED_ORG_KEY);
        } else {
          // Não-master sem team_member na org selecionada: limpar e tentar fallback
          console.log("⚠️ useCurrentTeamMember: Non-master sem acesso à org selecionada, limpando localStorage");
          localStorage.removeItem(SELECTED_ORG_KEY);
        }
      }

      // Fallback: buscar qualquer team_member ativo do user
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("❌ useCurrentTeamMember: Erro ao buscar:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: error,
        });
        throw error;
      }

      // Se encontrou team_member real, salvar e retornar
      if (data?.organization_id) {
        setSelectedOrgId(data.organization_id);
        console.log("✅ useCurrentTeamMember: Resultado:", {
          hasData: true,
          organizationId: data.organization_id,
        });
        return data as TeamMember;
      }

      // Master sem nenhum team_member: buscar primeira org disponível
      if (isMaster) {
        const { data: firstOrg } = await supabase
          .from("organizations")
          .select("id")
          .order("name")
          .limit(1)
          .maybeSingle();

        if (firstOrg) {
          setSelectedOrgId(firstOrg.id);
          console.log("✅ useCurrentTeamMember: Master virtual (primeira org):", { organizationId: firstOrg.id });
          return buildVirtualTeamMember(user.id, firstOrg.id);
        }
      }

      console.log("✅ useCurrentTeamMember: Resultado:", {
        hasData: false,
        organizationId: null,
      });

      return null;
    },
    enabled: !!user?.id && !masterLoading && !gestorLoading,
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}
