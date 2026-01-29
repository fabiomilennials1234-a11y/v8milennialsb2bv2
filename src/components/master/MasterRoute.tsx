/**
 * Componente de proteção de rota para área Master
 *
 * Verifica se o usuário é Master antes de renderizar o conteúdo.
 * Redireciona para a home se não for Master.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { toast } from "sonner";

interface MasterRouteProps {
  children: React.ReactNode;
}

export function MasterRoute({ children }: MasterRouteProps) {
  const { isMaster, isLoading } = useMasterAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isMaster) {
      toast.error("Acesso negado: área restrita");
      navigate("/", { replace: true });
    }
  }, [isMaster, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando permissões...</p>
        </div>
      </div>
    );
  }

  if (!isMaster) {
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
