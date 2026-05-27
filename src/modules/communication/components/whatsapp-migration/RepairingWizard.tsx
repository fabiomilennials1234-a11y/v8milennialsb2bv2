/**
 * RepairingWizard — 3-step modal pra migração Evolution→Uazapi de uma org.
 *
 * Step 1: Explicação (user lê, clica Continuar)
 * Step 2: Pausa workflows + deleta instâncias Evolution + cria nova Uazapi
 * Step 3: Mostra QR code. User escaneia → confirma.
 *
 * Atualiza organizations.whatsapp_migration_status em cada transição.
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, QrCode } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useCreateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useDeleteWhatsAppInstance,
} from "@/modules/communication/hooks/useWhatsAppInstances";
import { useSetMigrationStatus } from "@/modules/communication/hooks/useOrgWhatsAppMigration";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

type WizardStep = "intro" | "provisioning" | "pairing" | "done" | "error";

export function RepairingWizard({ open, onOpenChange, organizationId }: Props) {
  const [step, setStep] = useState<WizardStep>("intro");
  const [newInstanceId, setNewInstanceId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const createInstance = useCreateWhatsAppInstance();
  const deleteInstance = useDeleteWhatsAppInstance();
  const refreshQR = useRefreshQRCode();
  const checkStatus = useCheckConnectionStatus();
  const setMigration = useSetMigrationStatus();

  // Reset state ao abrir
  useEffect(() => {
    if (open) {
      setStep("intro");
      setNewInstanceId(null);
      setQrCode(null);
      setErrorMsg(null);
    }
  }, [open]);

  // Polling status durante pairing
  useEffect(() => {
    if (step !== "pairing" || !newInstanceId) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from("whatsapp_instances")
          .select("status")
          .eq("id", newInstanceId)
          .maybeSingle();
        if (data?.status === "connected" || data?.status === "open") {
          setStep("done");
          await setMigration.mutateAsync({
            organizationId,
            status: "migrated",
            completed: true,
          });
          clearInterval(interval);
        }
      } catch {
        /* silent */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [step, newInstanceId, organizationId, setMigration]);

  const startProvision = async () => {
    setStep("provisioning");
    setErrorMsg(null);
    try {
      await setMigration.mutateAsync({
        organizationId,
        status: "in_progress",
      });

      // Pausa workflows ativos
      await supabase
        .from("workflow_executions")
        .update({ status: "paused" })
        .eq("organization_id", organizationId)
        .eq("status", "running");

      // Deleta instâncias Evolution legadas
      const { data: evInstances } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name")
        .eq("organization_id", organizationId)
        .eq("provider", "evolution");

      for (const inst of evInstances ?? []) {
        try {
          await deleteInstance.mutateAsync({
            id: inst.id,
            instance_name: inst.instance_name,
          });
        } catch (e) {
          console.warn("[RepairingWizard] delete evolution failed:", e);
        }
      }

      // Cria instância Uazapi
      const name = `org-${organizationId.slice(0, 8)}-uazapi`;
      const newInst = await createInstance.mutateAsync({ instance_name: name });
      setNewInstanceId(newInst.id);

      // Request QR code
      const qrResp = await refreshQR.mutateAsync({ instance_id: newInst.id });
      setQrCode(qrResp.instance.qr_code ?? null);
      setStep("pairing");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStep("error");
      try {
        await setMigration.mutateAsync({
          organizationId,
          status: "failed",
        });
      } catch {
        /* silent */
      }
      toast.error(`Erro na migração: ${msg}`);
    }
  };

  const close = () => {
    if (step === "provisioning") return; // não fecha durante trabalho crítico
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "intro" && "Migrar conexão WhatsApp"}
            {step === "provisioning" && "Migrando..."}
            {step === "pairing" && "Escaneie o QR Code"}
            {step === "done" && "Migração concluída"}
            {step === "error" && "Erro na migração"}
          </DialogTitle>
          <DialogDescription>
            {step === "intro" &&
              "Vamos mover sua conexão WhatsApp para o novo provedor. Processo leva ~2 minutos."}
            {step === "provisioning" &&
              "Pausando workflows, removendo conexão anterior e provisionando nova instância."}
            {step === "pairing" &&
              "Escaneie o código no WhatsApp do celular para parear a nova instância."}
            {step === "done" && "Conexão ativa no novo provedor. Workflows pausados estão prontos para retomar."}
            {step === "error" && "Não foi possível completar a migração."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === "intro" && (
            <div className="space-y-3 text-sm">
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Workflows em execução serão pausados durante o processo.</li>
                <li>Sua conexão atual será desconectada e recriada no novo provedor.</li>
                <li>Você precisa escanear um novo QR code no WhatsApp.</li>
                <li>Histórico de mensagens fica preservado no banco.</li>
              </ul>
              <p className="text-xs text-muted-foreground italic">
                Pós-migração, workflows pausados precisam ser retomados manualmente em Settings.
              </p>
            </div>
          )}

          {step === "provisioning" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Provisionando...</p>
            </div>
          )}

          {step === "pairing" && (
            <div className="flex flex-col items-center gap-4">
              {qrCode ? (
                <>
                  <div className="p-4 bg-card rounded-lg border border-border">
                    <img
                      src={
                        qrCode.startsWith("data:")
                          ? qrCode
                          : `data:image/png;base64,${qrCode}`
                      }
                      alt="QR Code"
                      className="w-56 h-56"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Aguardando pareamento (verifica a cada 3s)
                  </div>
                </>
              ) : (
                <QrCode className="h-12 w-12 text-muted-foreground" />
              )}
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-sm">Migração concluída com sucesso!</p>
            </div>
          )}

          {step === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Migração falhou</p>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {errorMsg ?? "Erro desconhecido"}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "intro" && (
            <>
              <Button variant="outline" onClick={close}>Cancelar</Button>
              <Button onClick={startProvision}>Começar migração</Button>
            </>
          )}
          {(step === "done" || step === "error") && (
            <Button onClick={close}>
              {step === "error" ? "Fechar" : "Concluído"}
            </Button>
          )}
          {step === "pairing" && (
            <Button variant="outline" onClick={close}>
              Continuar pareando depois
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
