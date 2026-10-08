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
import { useAuth } from "../auth/contexts/AuthContext";
import {
  checkCurrentUserSubscription,
  type SubscriptionStatus,
} from "@/modules/billing/lib/subscription";
import { useUserRole, useCanManageCopilot } from "../permissions/hooks/useUserRole";
import { useIdentity } from "../auth/hooks/useIdentity";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { IS_DEMO_MODE } from "@/core/demo-mode";
import { OverdueBanner } from "@/modules/billing/components/subscription/OverdueBanner";
import { SubscriptionBlockedPage } from "@/modules/billing/components/subscription/SubscriptionBlockedPage";
import { LoadFailedScreen } from "./LoadFailedScreen";
import { Lock } from "lucide-react";

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
  const { isMaster, isLoading: masterLoading } = useIdentity();
  const { canManage: canManageCopilot, isLoading: copilotLoading } =
    useCanManageCopilot();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  // `undefined` = sem erro. Separado de `subscription` de propósito: falha de
  // consulta não é "sem assinatura" (ADR-0038).
  const [loadError, setLoadError] = useState<unknown>(undefined);
  const [attempt, setAttempt] = useState(0);

  const canBypassSubscription =
    isMaster || userRole?.role === "admin" || canManageCopilot;

  useEffect(() => {
    if (isMaster && !masterLoading) {
      setLoading(false);
      return;
    }
    if (!authLoading && !masterLoading && user) {
      setLoading(true);
      setLoadError(undefined);
      checkCurrentUserSubscription()
        .then(setSubscription)
        .catch((error: unknown) => {
          setSubscription(null);
          setLoadError(error ?? null);
        })
        .finally(() => setLoading(false));
    } else if (!authLoading && !user) {
      setLoading(false);
    }
    // `user?.id`, não `user`: o efeito faz setState na entrada (loading/erro),
    // então depender da IDENTIDADE do objeto transformaria qualquer `user`
    // recriado por render num laço que martela a RPC — o teste pegou 1.091
    // chamadas em 200 ms com um dublê que recriava o objeto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading, isMaster, masterLoading, attempt]);

  // Loading gate. Não espera copilotLoading nem roleLoading quando master
  // (master bypassa subscription check — esperar por feature perms cria
  // loader eterno se a query falha trocando para org sem team_member real).
  // Incidente 2026-04-24.
  const effectiveLoading = isMaster
    ? authLoading || masterLoading || loading
    : authLoading || loading || roleLoading || masterLoading || copilotLoading;

  // Modo demonstração (build de dev + VITE_DEMO_MODE=1). Em produção
  // `IS_DEMO_MODE` é a constante `false` e este bloco não chega ao bundle.
  // O gate de assinatura mora dentro do LayoutWrapper, então sem este bypass
  // a demo cai em /auth mesmo com o ProtectedRoute liberado.
  // Ver src/core/demo-mode.ts.
  if (IS_DEMO_MODE) {
    return <>{children}</>;
  }

  if (effectiveLoading) {
    return <TorqueLoader variant="full" />;
  }

  // Master bypasses everything
  if (isMaster) {
    return <>{children}</>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Falha fechada, mas honesta: sem assinatura confirmada não há acesso — e a
  // tela diz que não conseguiu verificar, em vez de "assinatura expirada" ou do
  // 404 de `/subscription-required`, rota que nunca existiu.
  if (loadError !== undefined || !subscription) {
    return (
      <LoadFailedScreen
        error={loadError ?? null}
        title="Não conseguimos confirmar sua assinatura"
        fallback="Não foi possível verificar a assinatura da sua organização. Tente de novo em instantes."
        source="boot:subscription"
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
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
    // Antes: Navigate para `/subscription-required?reason=trial_expired`, rota
    // que nunca existiu — o usuário em trial caía no 404 (ADR-0038).
    return <TrialLockedScreen />;
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

/** Área que pede assinatura ativa, vista por um membro em período de teste. */
function TrialLockedScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/40">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Disponível com a assinatura ativa</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        O período de teste da sua organização não inclui esta área. Fale com o administrador para ativar a assinatura.
      </p>
    </div>
  );
}
