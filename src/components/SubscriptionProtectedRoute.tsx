/**
 * Rota protegida que verifica subscription ativa
 *
 * Redireciona para página de subscription required se:
 * - Usuário não tem subscription válida
 * - Subscription expirou
 * - Subscription está suspensa/cancelada
 *
 * Admin e Closer bypassam requireActive (podem criar copilots mesmo em trial).
 */

import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { checkCurrentUserSubscription, type SubscriptionStatus } from '@/lib/subscription';
import { useUserRole } from '@/hooks/useUserRole';
import { Loader2 } from 'lucide-react';

interface SubscriptionProtectedRouteProps {
  children: ReactNode;
  requireActive?: boolean; // Se true, requer subscription ativa (não trial). Admin e Closer bypassam.
}

export function SubscriptionProtectedRoute({
  children,
  requireActive = false,
}: SubscriptionProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const canBypassSubscription = userRole?.role === 'admin' || userRole?.role === 'closer';

  useEffect(() => {
    if (!authLoading && user) {
      checkCurrentUserSubscription()
        .then(setSubscription)
        .catch(() => setSubscription(null))
        .finally(() => setLoading(false));
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading]);

  if (authLoading || loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-millennials-yellow" />
          <p className="text-muted-foreground">Verificando subscription...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!subscription) {
    // Usuário sem organização
    return <Navigate to="/subscription-required" replace />;
  }

  if (!subscription.isValid) {
    // Subscription inválida
    return <Navigate to="/subscription-required" replace />;
  }

  if (requireActive && subscription.status === 'trial' && !canBypassSubscription) {
    // Requer subscription ativa mas está em trial (admin e closer bypassam)
    return <Navigate to="/subscription-required?reason=trial_expired" replace />;
  }

  return <>{children}</>;
}
