/**
 * Componente de configurações do Google Calendar
 *
 * Permite ao usuário conectar/desconectar seu Google Calendar
 * com apenas um clique - o OAuth2 faz todo o trabalho automaticamente
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Calendar,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  Mail,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useGoogleCalendarStatus,
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendarCallback,
} from "@/hooks/useGoogleCalendar";
import { useAuth } from "@/contexts/AuthContext";

// Ícone do Google (SVG inline para não precisar de dependência extra)
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function GoogleCalendarSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { processCallback } = useGoogleCalendarCallback();
  const { session, loading: authLoading } = useAuth();

  const {
    data: status,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useGoogleCalendarStatus();

  // Verifica se o usuário está autenticado
  const hasToken = !!session?.access_token;
  
  // Debug - remover depois de resolver
  console.log("[GoogleCalendarSettings] State:", {
    authLoading,
    hasToken,
    isLoading,
    isFetching,
    isError,
    hasStatus: !!status,
    statusConnected: status?.connected,
  });
  
  // Mostra loading APENAS quando auth está carregando OU query está ativamente buscando
  const showLoading = authLoading || isFetching;

  const connectMutation = useConnectGoogleCalendar();
  const disconnectMutation = useDisconnectGoogleCalendar();

  // Processar callback do OAuth quando a página carregar
  useEffect(() => {
    const result = processCallback(searchParams);
    if (result !== null) {
      // Limpar query params após processar
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("google");
      newParams.delete("email");
      newParams.delete("reason");
      setSearchParams(newParams, { replace: true });
    }
  }, []);

  const handleConnect = () => {
    connectMutation.mutate();
  };

  const handleDisconnect = () => {
    disconnectMutation.mutate();
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Google Calendar
          </h3>
          <p className="text-sm text-muted-foreground">
            Conecte seu calendário para agendar reuniões automaticamente
          </p>
        </div>
        {status?.connected && (
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Conectado
          </Badge>
        )}
      </div>

      {!hasToken ? (
        // Usuário não autenticado
        <div className="p-6 border border-dashed rounded-lg text-center">
          <XCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground mb-2">
            Faça login para conectar seu Google Calendar
          </p>
        </div>
      ) : showLoading ? (
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="p-6 border border-dashed rounded-lg text-center">
          <XCircle className="w-10 h-10 mx-auto mb-3 text-destructive opacity-50" />
          <p className="text-muted-foreground mb-2">
            Erro ao verificar conexão
          </p>
          {error && (
            <p className="text-xs text-destructive mb-4">
              {error instanceof Error ? error.message : "Erro desconhecido"}
            </p>
          )}
          <Button variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : status?.connected ? (
        // Estado: Conectado
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 border rounded-lg bg-card"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <GoogleIcon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Conta Google Conectada</p>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Mail className="w-3 h-3" />
                    {status.google_email}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {status.connected_at && (
                  <div className="flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Conectado em {formatDate(status.connected_at)}
                  </div>
                )}
                {status.last_sync && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Última sincronização: {formatDate(status.last_sync)}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {status.scopes?.map((scope) => {
                  const scopeName = scope.split("/").pop() || scope;
                  return (
                    <Badge key={scope} variant="secondary" className="text-xs">
                      {scopeName.replace(".", " ")}
                    </Badge>
                  );
                })}
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  Desconectar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desconectar Google Calendar?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso revogará o acesso ao seu calendário. Você pode reconectar
                    a qualquer momento.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDisconnect}
                    className="bg-destructive hover:bg-destructive/90"
                    disabled={disconnectMutation.isPending}
                  >
                    {disconnectMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Desconectando...
                      </>
                    ) : (
                      "Desconectar"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </motion.div>
      ) : (
        // Estado: Não conectado
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 border border-dashed rounded-lg text-center"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <Calendar className="w-8 h-8 text-muted-foreground" />
          </div>

          <h4 className="font-medium mb-2">Conecte seu Google Calendar</h4>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Permita que o sistema crie e gerencie reuniões automaticamente no seu
            calendário. Você mantém total controle sobre as permissões.
          </p>

          <Button
            onClick={handleConnect}
            disabled={connectMutation.isPending}
            className="gap-2"
            size="lg"
          >
            {connectMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Conectando...
              </>
            ) : (
              <>
                <GoogleIcon className="w-5 h-5" />
                Conectar com Google
              </>
            )}
          </Button>

          <p className="text-xs text-muted-foreground mt-4">
            Você será redirecionado para a página de autorização do Google
          </p>
        </motion.div>
      )}

      {/* Info box */}
      <div className="p-4 bg-muted/50 rounded-lg">
        <h5 className="text-sm font-medium mb-2">O que acontece ao conectar?</h5>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-3 h-3 mt-0.5 text-success" />
            Reuniões são criadas automaticamente no seu calendário
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-3 h-3 mt-0.5 text-success" />
            Verificamos sua disponibilidade antes de agendar
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-3 h-3 mt-0.5 text-success" />
            Você recebe notificações normalmente pelo Google
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-3 h-3 mt-0.5 text-success" />
            Pode desconectar a qualquer momento
          </li>
        </ul>
      </div>
    </div>
  );
}
