/**
 * Componente de configuracoes Meta (Facebook/Instagram)
 *
 * Permite ao usuario conectar/desconectar suas paginas do Facebook
 * e contas do Instagram com apenas um clique via OAuth2.
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  AlertTriangle,
  Instagram,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  useMetaConnectionStatus,
  useConnectMeta,
  useDisconnectMeta,
  useToggleMetaPage,
  useMetaOAuthCallback,
} from "@/hooks/useMetaConnection";
import { MetaLeadgenConfig } from "./MetaLeadgenConfig";
import { toast } from "sonner";

// Icone do Facebook (SVG inline)
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// Icone do Messenger
function MessengerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111C24 4.974 18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8.2l3.131 3.259L19.752 8.2l-6.561 6.763z" />
    </svg>
  );
}

export function MetaSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    isLoading,
    isConnected,
    isExpired,
    connection,
    pages,
    instagramPages,
    totalPages,
    totalInstagram,
  } = useMetaConnectionStatus();
  const connectMeta = useConnectMeta();
  const disconnectMeta = useDisconnectMeta();
  const togglePage = useToggleMetaPage();
  const { handleCallback } = useMetaOAuthCallback();

  // Processa callback do OAuth
  useEffect(() => {
    const result = handleCallback(searchParams);
    if (result) {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      // Limpa parametros da URL
      searchParams.delete("meta");
      searchParams.delete("pages");
      searchParams.delete("instagram");
      searchParams.delete("reason");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  // Token expira em menos de 7 dias?
  const tokenExpiresAt = connection?.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;
  const daysUntilExpiry = tokenExpiresAt
    ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const tokenWarning = daysUntilExpiry !== null && daysUntilExpiry <= 7;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <FacebookIcon className="w-5 h-5 text-[#1877F2]" />
          Meta (Facebook & Instagram)
        </h3>
        <p className="text-sm text-muted-foreground">
          Conecte suas paginas do Facebook e contas do Instagram para receber
          mensagens e capturar leads de anuncios.
        </p>
      </div>

      {/* Status Card */}
      {!isConnected && !isExpired ? (
        // Nao conectado
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 py-8 border border-dashed rounded-lg"
        >
          <div className="flex items-center gap-3">
            <FacebookIcon className="w-10 h-10 text-[#1877F2]" />
            <div className="text-2xl text-muted-foreground">/</div>
            <Instagram className="w-10 h-10 text-[#E1306C]" />
          </div>
          <div className="text-center">
            <p className="font-medium">Nenhuma conta conectada</p>
            <p className="text-sm text-muted-foreground mt-1">
              Conecte sua conta do Facebook para receber mensagens do Messenger,
              Instagram Direct e capturar leads de anuncios.
            </p>
          </div>
          <Button
            onClick={() => {
              console.log("[MetaSettings] Botão clicado, VITE_META_APP_ID:", import.meta.env.VITE_META_APP_ID);
              connectMeta.mutate(undefined, {
                onError: (err) => {
                  console.error("[MetaSettings] Erro ao conectar:", err);
                  toast.error(err instanceof Error ? err.message : "Erro ao iniciar conexão Meta");
                },
              });
            }}
            disabled={connectMeta.isPending}
            className="gap-2 bg-[#1877F2] hover:bg-[#166FE5] text-white"
          >
            {connectMeta.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FacebookIcon className="w-4 h-4" />
            )}
            Conectar com Facebook
          </Button>
        </motion.div>
      ) : (
        // Conectado ou expirado
        <div className="space-y-4">
          {/* Connection Status */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between p-4 border rounded-lg"
          >
            <div className="flex items-center gap-3">
              <FacebookIcon className="w-8 h-8 text-[#1877F2]" />
              <div>
                <p className="font-medium">
                  {connection?.facebook_user_name || "Conta Facebook"}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {isConnected ? (
                    <Badge className="bg-success/20 text-success border-success/30 gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Conectado
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="w-3 h-3" />
                      Token Expirado
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {totalPages} pagina(s) | {totalInstagram} Instagram
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(isExpired || tokenWarning) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => connectMeta.mutate()}
                  disabled={connectMeta.isPending}
                  className="gap-1"
                >
                  {connectMeta.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Link2 className="w-3 h-3" />
                  )}
                  Reconectar
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 text-destructive hover:text-destructive">
                    <Unlink className="w-3 h-3" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar Meta?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso ira desconectar todas as paginas do Facebook e contas do
                      Instagram. Voce nao recebera mais mensagens desses canais ate
                      reconectar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (connection) {
                          disconnectMeta.mutate(connection.id, {
                            onSuccess: () => toast.success("Desconectado com sucesso!"),
                            onError: () => toast.error("Erro ao desconectar"),
                          });
                        }
                      }}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </motion.div>

          {/* Token Warning */}
          {tokenWarning && isConnected && (
            <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span>
                Seu token expira em{" "}
                <strong>{daysUntilExpiry} dia(s)</strong>. Reconecte para renovar.
              </span>
            </div>
          )}

          {/* Pages List */}
          {pages.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                Paginas e Contas Conectadas
              </h4>
              <div className="space-y-2">
                {pages.map((page) => (
                  <motion.div
                    key={page.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <MessengerIcon className="w-4 h-4 text-[#0084FF]" />
                          <span className="text-sm font-medium">
                            {page.page_name}
                          </span>
                        </div>
                        {page.instagram_username && (
                          <div className="flex items-center gap-2">
                            <Instagram className="w-4 h-4 text-[#E1306C]" />
                            <span className="text-sm text-muted-foreground">
                              @{page.instagram_username}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {page.webhook_subscribed ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Globe className="w-3 h-3" />
                          Webhook ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Webhook inativo
                        </Badge>
                      )}
                      <Switch
                        checked={page.is_active}
                        onCheckedChange={(checked) =>
                          togglePage.mutate({ pageId: page.id, isActive: checked })
                        }
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Lead Ads Config */}
          <div className="pt-4 border-t">
            <MetaLeadgenConfig />
          </div>
        </div>
      )}
    </div>
  );
}
