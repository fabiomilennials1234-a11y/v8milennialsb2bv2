import { useAuth } from "../contexts/AuthContext";
import { useMasterAuth } from "../../master/hooks/useMasterAuth";
import { useCurrentTeamMember } from "../../hooks/useTeamMembers";
import { useFeaturePermissions } from "../../permissions/hooks/useUserRole";

export interface Identity {
  userId: string | null;
  organizationId: string | null;
  teamMemberId: string | null;
  effectiveRole: "admin" | "member" | null;
  isMaster: boolean;
  isAdmin: boolean;
  features: Record<string, boolean>;
  isLoading: boolean;
  isReady: boolean;
}

export function useIdentity(): Identity {
  const { user } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: teamMember, isLoading: tmLoading } = useCurrentTeamMember();
  const { data: features, isLoading: featuresLoading } = useFeaturePermissions();

  const isLoading = masterLoading || tmLoading || featuresLoading;

  const rawRole = (teamMember as any)?.role ?? null;
  const effectiveRole: "admin" | "member" | null = isMaster
    ? "admin"
    : rawRole === "admin"
      ? "admin"
      : rawRole
        ? "member"
        : null;

  const isAdmin = isMaster || effectiveRole === "admin";
  const organizationId = (teamMember as any)?.organization_id ?? null;
  const teamMemberId = (teamMember as any)?.id ?? null;
  const userId = user?.id ?? null;

  const isReady = !isLoading && !!userId && (!!organizationId || isMaster);

  return {
    userId,
    organizationId,
    teamMemberId,
    effectiveRole,
    isMaster,
    isAdmin,
    features: features ?? {},
    isLoading,
    isReady,
  };
}
