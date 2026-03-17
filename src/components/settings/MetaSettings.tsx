/**
 * Componente de configuracoes Meta (Facebook/Instagram)
 *
 * Seções separadas para Facebook e Instagram, permitindo que o usuario
 * conecte contas diferentes para cada plataforma.
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
  RefreshCw,
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
  useMetaConnections,
  useMetaConnectionStatusByType,
  useConnectMeta,
  useDisconnectMeta,
  useToggleMetaPage,
  useMetaOAuthCallback,
  type ConnectionType,
  type MetaPage,
} from "@/hooks/useMetaConnection";
import { MetaLeadgenConfig } from "./MetaLeadgenConfig";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function MessengerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.975 12-11.111C24 4.974 18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8.2l3.131 3.259L19.752 8.2l-6.561 6.763z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ConnectionSection — reusable section for Facebook or Instagram
// ---------------------------------------------------------------------------

interface ConnectionSectionProps {
  type: ConnectionType;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accentColor: string;
  buttonLabel: string;
  disconnectLabel: string;
  renderPage: (page: MetaPage) => React.ReactNode;
  children?: React.ReactNode;
}

function ConnectionSection({
  type,
  icon,
  title,
  subtitle,
  accentColor,
  buttonLabel,
  disconnectLabel,
  renderPage,
  children,
}: ConnectionSectionProps) {
  const { isLoading, isConnected, isExpired, connection, pages, totalPages } =
    useMetaConnectionStatusByType(type);
  const connectMeta = useConnectMeta();
  const disconnectMeta = useDisconnectMeta();
  const togglePage = useToggleMetaPage();

  const tokenExpiresAt = connection?.token_expires_at
    ? new Date(connection.token_expires_at)
    : null;
  const daysUntilExpiry = tokenExpiresAt
    ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const tokenWarning = daysUntilExpiry !== null && daysUntilExpiry <= 7;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {!isConnected && !isExpired ? (
        /* Not connected */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 py-8 border border-dashed rounded-lg"
        >
          <div className="opacity-60">{icon}</div>
          <div className="text-center">
            <p className="font-medium">Nenhuma conta conectada</p>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <Button
            onClick={() => {
              connectMeta.mutate(type, {
                onError: (err) => {
                  console.error(`[MetaSettings] Erro ao conectar ${type}:`, err);
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "Erro ao iniciar conexao Meta"
                  );
                },
              });
            }}
            disabled={connectMeta.isPending}
            className="gap-2 text-white"
            style={{ backgroundColor: accentColor }}
          >
            {connectMeta.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              icon
            )}
            {buttonLabel}
          </Button>
        </motion.div>
      ) : (
        /* Connected or expired */
        <div className="space-y-4">
          {/* Connection Status */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between p-4 border rounded-lg"
          >
            <div className="flex items-center gap-3">
              {icon}
              <div>
                <p className="font-medium">
                  {connection?.facebook_user_name || title}
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
                    {totalPages}{" "}
                    {type === "instagram" ? "conta(s)" : "pagina(s)"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(isExpired || tokenWarning) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => connectMeta.mutate(type)}
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

              {isConnected && !isExpired && !tokenWarning && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    connectMeta.mutate({
                      connectionType: type,
                      authType: "rerequest",
                    })
                  }
                  disabled={connectMeta.isPending}
                  className="gap-1"
                >
                  {connectMeta.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Atualizar paginas
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Unlink className="w-3 h-3" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{disconnectLabel}</AlertDialogTitle>
                    <AlertDialogDescription>
                      Voce nao recebera mais mensagens desse canal ate
                      reconectar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (connection) {
                          disconnectMeta.mutate(connection.id, {
                            onSuccess: () =>
                              toast.success("Desconectado com sucesso!"),
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
                <strong>{daysUntilExpiry} dia(s)</strong>. Reconecte para
                renovar.
              </span>
            </div>
          )}

          {/* Empty Pages Warning */}
          {isConnected && pages.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">
                {type === "instagram"
                  ? "Nenhuma conta Instagram vinculada"
                  : "Nenhuma pagina vinculada"}
              </p>
              <p className="text-sm text-amber-700 mt-1">
                Durante a conexao, nenhuma pagina foi selecionada ou voce nao tem
                acesso de administrador a nenhuma pagina.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() =>
                  connectMeta.mutate({
                    connectionType: type,
                    authType: "rerequest",
                  })
                }
                disabled={connectMeta.isPending}
              >
                {connectMeta.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                Selecionar paginas
              </Button>
            </div>
          )}

          {/* Pages / Accounts List */}
          {pages.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {type === "instagram"
                  ? "Contas Instagram Conectadas"
                  : "Paginas Conectadas"}
              </h4>
              <div className="space-y-2">
                {pages.map((page) => (
                  <motion.div
                    key={page.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    {renderPage(page)}

                    <div className="flex items-center gap-3">
                      {page.webhook_subscribed ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Globe className="w-3 h-3" />
                          Webhook ativo
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                        >
                          Webhook inativo
                        </Badge>
                      )}
                      <Switch
                        checked={page.is_active}
                        onCheckedChange={(checked) =>
                          togglePage.mutate({
                            pageId: page.id,
                            isActive: checked,
                          })
                        }
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Extra content (e.g. Lead Ads config for Facebook) */}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MetaSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isLoading } = useMetaConnections();
  const { handleCallback } = useMetaOAuthCallback();

  // Process OAuth callback
  useEffect(() => {
    const result = handleCallback(searchParams);
    if (result) {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      searchParams.delete("meta");
      searchParams.delete("pages");
      searchParams.delete("instagram");
      searchParams.delete("reason");
      searchParams.delete("connectionType");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ---- Facebook Section ---- */}
      <ConnectionSection
        type="facebook"
        icon={<FacebookIcon className="w-6 h-6 text-[#1877F2]" />}
        title="Facebook"
        subtitle="Conecte suas paginas do Facebook para receber mensagens do Messenger e capturar leads de anuncios."
        accentColor="#1877F2"
        buttonLabel="Conectar com Facebook"
        disconnectLabel="Desconectar Facebook?"
        renderPage={(page) => (
          <div className="flex items-center gap-3">
            <MessengerIcon className="w-4 h-4 text-[#0084FF]" />
            <span className="text-sm font-medium">{page.page_name}</span>
          </div>
        )}
      >
        {/* Lead Ads config lives under Facebook */}
        <div className="pt-4 border-t">
          <MetaLeadgenConfig />
        </div>
      </ConnectionSection>

      <hr className="border-border" />

      {/* ---- Instagram Section ---- */}
      <ConnectionSection
        type="instagram"
        icon={<Instagram className="w-6 h-6 text-[#E1306C]" />}
        title="Instagram"
        subtitle="Conecte sua conta do Instagram para receber mensagens do Instagram Direct."
        accentColor="#E1306C"
        buttonLabel="Conectar com Instagram"
        disconnectLabel="Desconectar Instagram?"
        renderPage={(page) => (
          <div className="flex items-center gap-3">
            <Instagram className="w-4 h-4 text-[#E1306C]" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {page.instagram_username
                  ? `@${page.instagram_username}`
                  : page.page_name}
              </span>
              {page.instagram_username && (
                <span className="text-xs text-muted-foreground">
                  {page.page_name}
                </span>
              )}
            </div>
          </div>
        )}
      />
    </div>
  );
}
