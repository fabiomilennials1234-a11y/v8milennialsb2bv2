/**
 * CommandGroupUazapi — grupo "WhatsApp" no CommandPalette.
 *
 * C2 Onda 5: ações reais Uazapi com modais existentes.
 *   - Importar histórico WhatsApp → HistorySyncDialog
 *   - Reparar conexão WhatsApp   → RepairingWizard
 *   - Disparar campanha em massa → navega para /campanhas
 *
 * Permission check via useIdentity — ações destrutivas requerem admin.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DatabaseBackup, Wrench, Megaphone } from "lucide-react";
import { CommandGroup, CommandItem } from "cmdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/hooks/chat/useWhatsAppInstances";
import { HistorySyncDialog } from "@/components/chat/history-sync/HistorySyncDialog";
import { RepairingWizard } from "@/components/whatsapp-migration/RepairingWizard";
import { useCurrentTeamMember } from "@/modules/identity";
import { pushRecent } from "../recentCommands";

interface CommandGroupUazapiProps {
  onClose: () => void;
}

const ITEM_CLASS = cn(
  "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
  "cursor-default select-none",
  "aria-selected:bg-muted/60",
  "hover:bg-muted/40",
  "transition-colors duration-75",
);

export function CommandGroupUazapi({ onClose }: CommandGroupUazapiProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIdentity();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: instances = [] } = useWhatsAppInstancesForUser();

  const [historySyncOpen, setHistorySyncOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  // Primeira instância conectada (ou primeira disponível)
  const activeInstance =
    instances.find((i) => i.status === "connected") ?? instances[0] ?? null;

  const organizationId = teamMember?.organization_id ?? null;

  const handleSelect = (id: string, action: () => void) => {
    if (user?.id) pushRecent(user.id, id);
    action();
  };

  // Sem admin e sem instâncias — ocultar grupo
  if (!isAdmin && !activeInstance) return null;

  return (
    <>
      <CommandGroup
        heading="WhatsApp"
        className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
      >
        {/* Importar histórico */}
        {activeInstance && (
          <CommandItem
            value="uazapi-importar-historico whatsapp importar historico sincronizar mensagens"
            onSelect={() =>
              handleSelect("uazapi-importar-historico", () => setHistorySyncOpen(true))
            }
            className={ITEM_CLASS}
          >
            <DatabaseBackup className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium leading-tight text-foreground">
                Importar histórico WhatsApp
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {activeInstance.instance_name}
              </span>
            </div>
          </CommandItem>
        )}

        {/* Reparar conexão */}
        {isAdmin && organizationId && (
          <CommandItem
            value="uazapi-reparar-conexao whatsapp reparar conexao migrar evolution uazapi"
            onSelect={() =>
              handleSelect("uazapi-reparar-conexao", () => setRepairOpen(true))
            }
            className={ITEM_CLASS}
          >
            <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium leading-tight text-foreground">
                Reparar conexão WhatsApp
              </span>
              <span className="text-xs text-muted-foreground">
                Migra instância Evolution → Uazapi
              </span>
            </div>
          </CommandItem>
        )}

        {/* Campanha em massa */}
        <CommandItem
          value="uazapi-campanha-massa disparar campanha massa envio bulk whatsapp"
          onSelect={() =>
            handleSelect("uazapi-campanha-massa", () => {
              navigate("/campanhas");
              onClose();
            })
          }
          className={ITEM_CLASS}
        >
          <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium leading-tight text-foreground">
              Disparar campanha em massa
            </span>
            <span className="text-xs text-muted-foreground">
              Gerenciar campanhas de WhatsApp
            </span>
          </div>
        </CommandItem>
      </CommandGroup>

      {/* Modais */}
      <HistorySyncDialog
        instanceId={activeInstance?.id ?? null}
        open={historySyncOpen}
        onOpenChange={(open) => {
          setHistorySyncOpen(open);
          if (!open) onClose();
        }}
      />

      {isAdmin && organizationId && (
        <RepairingWizard
          open={repairOpen}
          onOpenChange={(open) => {
            setRepairOpen(open);
            if (!open) onClose();
          }}
          organizationId={organizationId}
        />
      )}
    </>
  );
}
