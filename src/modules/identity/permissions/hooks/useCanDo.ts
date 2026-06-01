import { useIdentity } from "../../auth/hooks/useIdentity";
import {
  ACTION_TO_FEATURE,
  resolvePermission,
  type AppAction,
} from "@/shared/permission-actions";

type ActionOrFeature = AppAction | string;

interface CanDoResult {
  allowed: boolean;
  reason: string;
  isLoading: boolean;
}

export function useCanDo(action: ActionOrFeature): CanDoResult {
  const identity = useIdentity();

  if (identity.isLoading) {
    return { allowed: false, reason: "loading", isLoading: true };
  }

  const isAction = action in ACTION_TO_FEATURE;

  if (isAction) {
    const result = resolvePermission(action as AppAction, {
      isMaster: identity.isMaster,
      role: identity.effectiveRole,
      featurePermissions: identity.features,
    });
    return { ...result, isLoading: false };
  }

  if (identity.isMaster) return { allowed: true, reason: "master", isLoading: false };
  if (identity.isAdmin) return { allowed: true, reason: "admin", isLoading: false };

  const allowed = identity.features[action] === true;
  return {
    allowed,
    reason: allowed ? `feature:${action}` : `denied:${action}`,
    isLoading: false,
  };
}
