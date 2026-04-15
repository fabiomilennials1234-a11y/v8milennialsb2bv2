/**
 * SubscriptionProtectedRoute — guard de lifecycle completo.
 *
 * - Master users bypass everything.
 * - billing_override orgs bypass everything.
 * - 'active' / 'trial' → allowed (trial blocked if requireActive=true and not admin).
 * - 'overdue' → allowed with OverdueBanner warning.
 * - 'suspended' / 'cancelled' / 'expired' → SubscriptionBlockedPage.
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  checkCurrentUserSubscription,
  type SubscriptionStatus,
} from "@/lib/subscription";
import { useUserRole, useCanManageCopilot } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { OverdueBanner } from "@/components/subscription/OverdueBanner";
import { SubscriptionBlockedPage } from "@/components/subscription/SubscriptionBlockedPage";

interface SubscriptionProtectedRouteProps {
  children: ReactNode;
  requireActive?: boolean;
}

export function SubscriptionProtectedRoute({
  children,
  requireActive = false,
}: SubscriptionProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { canManage: canManageCopilot, isLoading: copilotLoading } =
    useCanManageCopilot();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const canBypassSubscription =
    isMaster || userRole?.role === "admin" || canManageCopilot;

  useEffect(() => {
    if (isMaster && !masterLoading) {
      setLoading(false);
      return;
    }
    if (!authLoading && !masterLoading && user) {
      checkCurrentUserSubscription()
        .then(setSubscription)
        .catch(() => setSubscription(null))
        .finally(() => setLoading(false));
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading, isMaster, masterLoading]);

  if (authLoading || loading || roleLoading || masterLoading || copilotLoading) {
    return <TorqueLoader variant="full" />;
  }

  // Master bypasses everything
  if (isMaster) {
    return <>{children}</>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!subscription) {
    return <Navigate to="/subscription-required" replace />;
  }

  // Blocked states — full-page block
  if (subscription.isBlocked) {
    return (
      <SubscriptionBlockedPage
        status={subscription.status as "suspended" | "cancelled" | "expired"}
        plan={subscription.plan}
      />
    );
  }

  // Trial + requireActive check (only for premium features like copilot creation)
  if (
    requireActive &&
    subscription.status === "trial" &&
    !canBypassSubscription
  ) {
    return (
      <Navigate to="/subscription-required?reason=trial_expired" replace />
    );
  }

  // Overdue — allow access but show warning banner
  if (subscription.isOverdue) {
    return (
      <>
        <OverdueBanner graceRemaining={subscription.graceRemaining ?? 0} />
        {children}
      </>
    );
  }

  // Active or trial — normal access
  return <>{children}</>;
}
