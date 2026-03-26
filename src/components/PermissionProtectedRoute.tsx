import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useFeaturePermission, useIsAdmin } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { Loader2 } from "lucide-react";

interface PermissionProtectedRouteProps {
  featureKey: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionProtectedRoute({
  featureKey,
  children,
  fallback,
}: PermissionProtectedRouteProps) {
  const { allowed, isLoading } = useFeaturePermission(featureKey);
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();

  // Esperar apenas admin/master resolver (rápido — vem do cache do ProtectedRoute)
  if (adminLoading || masterLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Admin/master: liberar imediatamente sem esperar edge function de permissions
  if (isMaster || isAdmin) {
    return <>{children}</>;
  }

  // Usuário regular: esperar feature permissions (edge function)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (allowed) {
    return <>{children}</>;
  }

  return (
    fallback ?? (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <Lock className="h-8 w-8" />
        <p className="text-sm font-medium">
          Voce nao tem permissao para acessar esta pagina.
        </p>
        <p className="text-xs">Solicite acesso ao administrador.</p>
      </div>
    )
  );
}
