import { useState } from "react";
import { Mail, Plus, Trash2, Power, PowerOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEmailAccounts, useDisconnectEmailAccount, useToggleEmailAccount } from "@/modules/communication/hooks/useEmailAccounts";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const PROVIDER_CONFIG = {
  gmail: {
    label: "Gmail",
    icon: "G",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
  outlook: {
    label: "Outlook",
    icon: "O",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "secondary" },
  syncing: { label: "Sincronizando...", variant: "default" },
  synced: { label: "Sincronizado", variant: "outline" },
  error: { label: "Erro", variant: "destructive" },
};

export function EmailAccountConnect() {
  const { data: accounts, isLoading } = useEmailAccounts();
  const disconnect = useDisconnectEmailAccount();
  const toggle = useToggleEmailAccount();
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  const handleConnect = (provider: "gmail" | "outlook") => {
    toast.info(`Integração ${provider === "gmail" ? "Gmail" : "Outlook"} será disponibilizada em breve.`);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Contas de Email
          </CardTitle>
          <CardDescription>
            Conecte suas contas de email para sincronizar mensagens automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {accounts && accounts.length > 0 && (
                <div className="space-y-3">
                  {accounts.map((account) => {
                    const provider = PROVIDER_CONFIG[account.provider];
                    const status = STATUS_CONFIG[account.sync_status];
                    return (
                      <div
                        key={account.id}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-lg border p-3",
                          !account.is_active && "opacity-50"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm", provider.bg, provider.color)}>
                            {provider.icon}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{account.email_address}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={status.variant} className="text-[10px] px-1.5 py-0 h-4">
                                {account.sync_status === "synced" && <CheckCircle2 className="w-2.5 h-2.5 mr-1" />}
                                {account.sync_status === "error" && <AlertCircle className="w-2.5 h-2.5 mr-1" />}
                                {status.label}
                              </Badge>
                              {account.last_sync_at && (
                                <span className="text-[10px] text-muted-foreground">
                                  Último sync: {formatDistanceToNow(new Date(account.last_sync_at), { addSuffix: true, locale: ptBR })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggle.mutate({ accountId: account.id, isActive: !account.is_active })}
                            title={account.is_active ? "Desativar" : "Ativar"}
                          >
                            {account.is_active ? (
                              <Power className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <PowerOff className="w-4 h-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDisconnectId(account.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="gap-2" onClick={() => handleConnect("gmail")}>
                  <span className="font-bold text-red-500">G</span>
                  Conectar Gmail
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => handleConnect("outlook")}>
                  <span className="font-bold text-blue-500">O</span>
                  Conectar Outlook
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!disconnectId} onOpenChange={(open) => !open && setDisconnectId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar conta?</AlertDialogTitle>
            <AlertDialogDescription>
              Emails sincronizados serão mantidos, mas novos emails não serão mais importados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (disconnectId) {
                  disconnect.mutate(disconnectId);
                  setDisconnectId(null);
                }
              }}
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
