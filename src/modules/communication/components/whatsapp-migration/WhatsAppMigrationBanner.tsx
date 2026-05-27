/**
 * WhatsAppMigrationBanner — notifica org quando migration_status='pending'.
 *
 * Renderiza no topo de Settings > WhatsApp com CTA "Migrar agora".
 * Hidden quando migrated, not_started sem ação pendente, ou in_progress.
 */
import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOrgMigrationStatus } from "@/modules/communication/hooks/useOrgWhatsAppMigration";
import { RepairingWizard } from "./RepairingWizard";

export function WhatsAppMigrationBanner() {
  const { data: org } = useOrgMigrationStatus();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (!org) return null;
  const status = org.whatsapp_migration_status;
  if (status !== "pending" && status !== "failed") return null;

  return (
    <>
      <div
        className={cn(
          "rounded-lg border p-4 flex items-start gap-3 mb-4",
          status === "failed"
            ? "border-destructive/40 bg-destructive/5"
            : "border-amber-500/40 bg-amber-500/5"
        )}
        role="alert"
      >
        <AlertTriangle
          className={cn(
            "h-5 w-5 mt-0.5 flex-shrink-0",
            status === "failed" ? "text-destructive" : "text-amber-600"
          )}
        />
        <div className="flex-1">
          <h4 className="font-medium text-sm">
            {status === "pending"
              ? "Migração WhatsApp pendente"
              : "Migração anterior falhou"}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {status === "pending"
              ? "Sua conexão WhatsApp precisa ser re-pareada para funcionar no novo provedor. Processo leva ~2 minutos."
              : "Houve erro na última tentativa. Tente novamente ou contate o suporte."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setWizardOpen(true)}
          className="flex-shrink-0"
        >
          Migrar agora
          <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </div>

      <RepairingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={org.id}
      />
    </>
  );
}
