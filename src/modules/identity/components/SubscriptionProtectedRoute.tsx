/**
 * SubscriptionProtectedRoute — guard de lifecycle completo.
 *
 * - Master users bypass everything.
 * - billing_override orgs bypass everything.
 * - 'active' / 'trial' → allowed (trial blocked if requireActive=true and not admin).
 * - 'overdue' → allowed with OverdueBanner warning.
 * - 'suspended' / 'cancelled' / 'expired' → SubscriptionBlockedPage.
 */

import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/contexts/AuthContext";
import { subscriptionStatusQueryOptions } from "@/modules/billing/lib/subscription";
import { useUserRole, useCanManageCopilot } from "../permissions/hooks/useUserRole";
import { useMasterAuth } from "../master/hooks/useMasterAuth";
import { useCurrentTeamMember } from "../org-team/hooks/useCurrentTeamMember";
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
  // `useMasterAuth`, não `useIdentity`: o `isLoading` de useIdentity inclui as
  // feature permissions (edge get-member-permissions), e a assinatura não
  // depende delas. Esperá-las punha uma ida de rede a mais na frente da tela.
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const {
    data: teamMember,
    isLoading: teamMemberLoading,
    error: teamMemberError,
    refetch: refetchTeamMember,
  } = useCurrentTeamMember();
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { canManage: canManageCopilot, isLoading: copilotLoading } =
    useCanManageCopilot();

  // A org do vínculo ATUAL (a que o org switcher escolheu). Antes a checagem
  // fazia o próprio `team_members … limit 1` sem ordem: em multi-org podia
  // validar a assinatura de OUTRA org. Mudança declarada (perf boot, 21/11).
  const organizationId = teamMember?.organization_id ?? null;

  // Dispara assim que a org existe — em paralelo a papel/feature permissions,
  // não depois delas. Mesma chave do `useCopilotSubscription`: uma RPC só.
  const subscriptionQuery = useQuery({
    ...subscriptionStatusQueryOptions(organizationId),
    enabled: !!user && !!organizationId && !masterLoading && !isMaster,
  });
  const subscription = subscriptionQuery.data ?? null;
  // `undefined` = sem erro. Separado de `subscription` de propósito: falha de
  // consulta não é "sem assinatura" (ADR-0038).
  const loadError: unknown =
    subscriptionQuery.error ?? (!teamMember && teamMemberError ? teamMemberError : undefined);
  const subscriptionLoading =
    !!organizationId && subscriptionQuery.isPending && !subscriptionQuery.isError;

  const canBypassSubscription =
    isMaster || userRole?.role === "admin" || canManageCopilot;

  // Papel e permissão de Copilot só decidem o caso trial + requireActive. Fora
  // dele não há o que esperar: a tela não muda com a resposta.
  const decisaoDependeDoPapel = requireActive && subscription?.status === "trial";

  // Loading gate. Master não espera nada além da própria identidade (master
  // bypassa subscription — esperar por feature perms cria loader eterno se a
  // query falha trocando para org sem team_member real). Incidente 2026-04-24.
  const effectiveLoading = isMaster
    ? authLoading || masterLoading
    : authLoading ||
      masterLoading ||
      teamMemberLoading ||
      subscriptionLoading ||
      (decisaoDependeDoPapel && (roleLoading || copilotLoading));

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
        onRetry={() => {
          if (!teamMember) void refetchTeamMember();
          if (organizationId) void subscriptionQuery.refetch();
        }}
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
