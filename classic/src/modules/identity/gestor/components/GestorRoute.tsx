/**
 * Guard da Área do Gestor (`/gestor`). Espelha `MasterRoute`.
 *
 * Nega quem não é Gestor de Portfólio ativo, redirecionando para a home.
 * Contraparte: `MasterRoute` já nega um Gestor (usa `isMaster`, que é falso
 * para o Gestor) — ver ADR-0021 §5 ("/master nega gestor; /gestor nega não-gestor").
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useGestor } from "../hooks/useGestor";

interface GestorRouteProps {
  children: React.ReactNode;
}

export function GestorRoute({ children }: GestorRouteProps) {
  const { isGestor, isLoading } = useGestor();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isGestor) {
      toast.error("Acesso negado: área restrita");
      navigate("/", { replace: true });
    }
  }, [isGestor, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  if (!isGestor) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldAlert className="w-16 h-16 text-destructive" />
          <h1 className="text-2xl font-bold">Acesso Negado</h1>
          <p className="text-muted-foreground">
            Você não tem permissão para acessar esta área.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
