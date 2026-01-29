import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Plus,
  Trash2,
  RefreshCw,
  QrCode,
  CheckCircle2,
  XCircle,
  Loader2,
  LogOut,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  useWhatsAppInstances,
  useCreateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useDeleteWhatsAppInstance,
  useLogoutInstance,
  WhatsAppInstance,
} from "@/hooks/useWhatsAppInstances";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import {
  useAllowedMembersForInstance,
  useSetAllowedMembersForInstance,
} from "@/hooks/useWhatsAppInstanceAllowedMembers";
import { Checkbox } from "@/components/ui/checkbox";
import { testEvolutionConnection } from "@/lib/evolutionApi";
import { toast } from "sonner";

function QRCodeModal({
  instance,
  isOpen,
  onClose,
}: {
  instance: WhatsAppInstance | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const refreshQR = useRefreshQRCode();
  const checkStatus = useCheckConnectionStatus();
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!isOpen || !instance) return;

    // Verificar status a cada 3 segundos
    const interval = setInterval(async () => {
      if (instance.instance_name) {
        setIsChecking(true);
        try {
          await checkStatus.mutateAsync(instance.instance_name);
        } catch (error) {
          console.error("Erro ao verificar status:", error);
        } finally {
          setIsChecking(false);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen, instance, checkStatus]);

  const handleRefreshQR = async () => {
    if (!instance?.instance_name) return;
    try {
      await refreshQR.mutateAsync(instance.instance_name);
      toast.success("QR Code atualizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao atualizar QR Code";
      toast.error(errorMessage);
      console.error("Erro ao atualizar QR Code:", error);
    }
  };

  if (!instance) return null;

  const qrCodeData = instance.qr_code?.startsWith("data:image")
    ? instance.qr_code
    : `data:image/png;base64,${instance.qr_code}`;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Escaneie o QR code com seu WhatsApp para conectar
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {instance.qr_code ? (
            <>
              <div className="p-4 bg-card rounded-lg border border-border">
                <img
                  src={qrCodeData}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64"
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Abra o WhatsApp no seu celular, vá em Configurações → Aparelhos conectados →
                Conectar um aparelho e escaneie este código
              </p>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    instance.status === "connected"
                      ? "default"
                      : instance.status === "connecting"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {instance.status === "connected" && (
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                  )}
                  {instance.status === "connecting" && (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  )}
                  {instance.status === "disconnected" && (
                    <XCircle className="w-3 h-3 mr-1" />
                  )}
                  {instance.status === "connected"
                    ? "Conectado"
                    : instance.status === "connecting"
                    ? "Conectando..."
                    : "Desconectado"}
                </Badge>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">QR Code não disponível</p>
            </div>
          )}
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshQR} disabled={refreshQR.isPending}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar QR Code
          </Button>
          {instance.status === "connected" && (
            <Button onClick={onClose}>
              Concluído
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppSettings() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [qrCodeInstance, setQrCodeInstance] = useState<WhatsAppInstance | null>(null);
  const [deleteInstanceId, setDeleteInstanceId] = useState<{ id: string; name: string } | null>(null);
  const [vendedoresInstance, setVendedoresInstance] = useState<WhatsAppInstance | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [apiStatus, setApiStatus] = useState<"unknown" | "connected" | "error">("unknown");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const { data: teamMembers = [] } = useTeamMembers();
  const createInstance = useCreateWhatsAppInstance();
  const deleteInstance = useDeleteWhatsAppInstance();
  const checkStatus = useCheckConnectionStatus();
  const logout = useLogoutInstance();
  const { isAdmin } = useIsAdmin();
  const { data: allowedMembers = [] } = useAllowedMembersForInstance(vendedoresInstance?.id ?? null);
  const setAllowedMembers = useSetAllowedMembersForInstance();
  const [selectedVendedores, setSelectedVendedores] = useState<Set<string>>(new Set());
  const [vendedoresDirty, setVendedoresDirty] = useState(false);

  const allowedIdsStr = useMemo(
    () => allowedMembers.map((a) => a.team_member_id).sort().join(","),
    [allowedMembers]
  );
  useEffect(() => {
    if (vendedoresInstance && !vendedoresDirty) {
      setSelectedVendedores(new Set(allowedMembers.map((a) => a.team_member_id)));
    }
  }, [vendedoresInstance?.id, allowedIdsStr]);

  const handleSaveVendedores = async () => {
    if (!vendedoresInstance) return;
    try {
      await setAllowedMembers.mutateAsync({
        whatsappInstanceId: vendedoresInstance.id,
        teamMemberIds: Array.from(selectedVendedores),
      });
      toast.success("Vendedores atualizados. Somente os selecionados poderão responder neste número.");
      setVendedoresInstance(null);
    } catch (e: any) {
      toast.error(e.message || "Erro ao salvar");
    }
  };

  const toggleVendedor = (teamMemberId: string) => {
    setSelectedVendedores((prev) => {
      const next = new Set(prev);
      if (next.has(teamMemberId)) next.delete(teamMemberId);
      else next.add(teamMemberId);
      return next;
    });
    setVendedoresDirty(true);
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setErrorDetails(null);
    try {
      const result = await testEvolutionConnection();
      if (result.working) {
        setApiStatus("connected");
        toast.success(`Conexão bem-sucedida! ${result.message || ""}`);
      } else {
        setApiStatus("error");
        setErrorDetails(result.message);
        toast.error(`Falha na conexão: ${result.message}`);
      }
    } catch (error: any) {
      setApiStatus("error");
      const errorMsg = error.message || "Erro desconhecido ao testar conexão";
      setErrorDetails(errorMsg);
      toast.error(`Erro ao testar conexão: ${errorMsg}`);
      console.error("Erro ao testar conexão:", error);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleCreate = async () => {
    if (!instanceName.trim()) {
      toast.error("Nome da instância é obrigatório");
      return;
    }

    setErrorDetails(null);
    try {
      const newInstance = await createInstance.mutateAsync({
        instance_name: instanceName.trim(),
      });
      toast.success("Instância criada! Escaneie o QR code para conectar.");
      setIsCreateDialogOpen(false);
      setInstanceName("");
      setQrCodeInstance(newInstance);
      setApiStatus("connected");
    } catch (error: any) {
      setApiStatus("error");
      const errorMessage = error.message || "Erro ao criar instância";
      const statusCode = error.status ? ` (Status: ${error.status})` : "";
      const fullMessage = `${errorMessage}${statusCode}`;
      
      setErrorDetails(fullMessage);
      toast.error(fullMessage, {
        description: error.errorData?.message || error.statusText || "",
        duration: 5000,
      });
      console.error("Erro detalhado ao criar instância:", {
        message: error.message,
        status: error.status,
        statusText: error.statusText,
        errorData: error.errorData,
        stack: error.stack,
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteInstanceId) return;
    try {
      const result = await deleteInstance.mutateAsync({
        id: deleteInstanceId.id,
        instance_name: deleteInstanceId.name,
      });
      setDeleteInstanceId(null);
      if (result.removedFromEvolution) {
        toast.success("Instância removida do sistema e da Evolution API.");
      } else {
        toast.success("Instância removida do sistema.", {
          description: result.evolutionError,
          duration: 6000,
        });
      }
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao remover instância";
      toast.error(errorMessage);
      console.error("Erro ao remover instância:", error);
    }
  };

  const handleCheckStatus = async (instanceName: string) => {
    try {
      await checkStatus.mutateAsync(instanceName);
      toast.success("Status atualizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao verificar status";
      toast.error(errorMessage);
      console.error("Erro ao verificar status:", error);
    }
  };

  const handleLogout = async (instanceName: string) => {
    try {
      await logout.mutateAsync(instanceName);
      toast.success("Logout realizado!");
    } catch (error: any) {
      const errorMessage = error.message || "Erro ao fazer logout";
      toast.error(errorMessage);
      console.error("Erro ao fazer logout:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return (
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Conectado
          </Badge>
        );
      case "connecting":
        return (
          <Badge className="bg-warning/20 text-warning border-warning/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Conectando
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Erro
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <XCircle className="w-3 h-3 mr-1" />
            Desconectado
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Instâncias WhatsApp</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie suas conexões WhatsApp via Evolution API
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleTestConnection}
            variant="outline"
            size="sm"
            disabled={isTestingConnection}
            className="gap-2"
          >
            {isTestingConnection ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Testar Conexão
              </>
            )}
          </Button>
          {apiStatus !== "unknown" && (
            <Badge
              variant={apiStatus === "connected" ? "default" : "destructive"}
              className="gap-1"
            >
              {apiStatus === "connected" ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  API Conectada
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3" />
                  API Desconectada
                </>
              )}
            </Badge>
          )}
          {isAdmin && (
            <Button onClick={() => setIsCreateDialogOpen(true)} size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Nova Instância
            </Button>
          )}
        </div>
      </div>

      {errorDetails && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Erro Detalhado:</p>
              <p className="text-xs text-muted-foreground mt-1 break-all">{errorDetails}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(errorDetails);
                toast.success("Erro copiado para a área de transferência");
              }}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-lg">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma instância WhatsApp cadastrada</p>
          {isAdmin && (
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              variant="outline"
              className="mt-4"
            >
              Criar primeira instância
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {instances.map((instance) => (
            <motion.div
              key={instance.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 border rounded-lg bg-card hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium">{instance.instance_name}</h4>
                    {getStatusBadge(instance.status)}
                  </div>
                  {instance.phone_number && (
                    <p className="text-sm text-muted-foreground">
                      {instance.phone_number}
                    </p>
                  )}
                  {instance.last_connection_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Última conexão:{" "}
                      {new Date(instance.last_connection_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVendedoresInstance(instance)}
                      title="Definir quem pode responder neste número"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Vendedores
                    </Button>
                  )}
                  {instance.status !== "connected" && instance.qr_code && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQrCodeInstance(instance)}
                    >
                      <QrCode className="w-4 h-4 mr-2" />
                      Ver QR Code
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckStatus(instance.instance_name)}
                    disabled={checkStatus.isPending}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  {instance.status === "connected" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLogout(instance.instance_name)}
                      disabled={logout.isPending}
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDeleteInstanceId({
                          id: instance.id,
                          name: instance.instance_name,
                        })
                      }
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Instância WhatsApp</DialogTitle>
            <DialogDescription>
              Crie uma nova instância para conectar um número WhatsApp
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="instance-name">Nome da Instância</Label>
              <Input
                id="instance-name"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="Ex: whatsapp-principal"
              />
              <p className="text-xs text-muted-foreground">
                Use apenas letras, números e hífens
              </p>
            </div>
          </div>
          {errorDetails && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-xs text-destructive break-all">{errorDetails}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsCreateDialogOpen(false);
              setErrorDetails(null);
            }}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createInstance.isPending}>
              {createInstance.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Instância"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Modal */}
      <QRCodeModal
        instance={qrCodeInstance}
        isOpen={!!qrCodeInstance}
        onClose={() => {
          setQrCodeInstance(null);
          // Verificar status ao fechar
          if (qrCodeInstance?.instance_name) {
            handleCheckStatus(qrCodeInstance.instance_name);
          }
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteInstanceId}
        onOpenChange={() => setDeleteInstanceId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Instância?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A instância será removida da Evolution API e do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Vendedores que podem responder neste número */}
      <Dialog
        open={!!vendedoresInstance}
        onOpenChange={(open) => {
          if (!open) {
            setVendedoresInstance(null);
            setVendedoresDirty(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Quem pode responder neste número?
            </DialogTitle>
            <DialogDescription>
              Somente os vendedores selecionados poderão responder no chat deste número. Deixe nenhum selecionado para todos da organização poderem responder.
            </DialogDescription>
          </DialogHeader>
          {vendedoresInstance && (
            <p className="text-sm font-medium text-muted-foreground">
              Número: {vendedoresInstance.instance_name}
              {vendedoresInstance.phone_number && ` (${vendedoresInstance.phone_number})`}
            </p>
          )}
          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {teamMembers
              .filter((m) => m.is_active)
              .map((member) => (
                <label
                  key={member.id}
                  className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedVendedores.has(member.id)}
                    onCheckedChange={() => toggleVendedor(member.id)}
                  />
                  <span className="font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">({member.role})</span>
                </label>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendedoresInstance(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveVendedores}
              disabled={setAllowedMembers.isPending || !vendedoresDirty}
            >
              {setAllowedMembers.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
