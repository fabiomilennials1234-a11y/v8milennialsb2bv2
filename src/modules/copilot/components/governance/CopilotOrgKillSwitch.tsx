/**
 * CopilotOrgKillSwitch — org-wide Copilot v2 kill-switch + pause banner (W10).
 *
 * - When the org is paused (admin kill-switch OR the hard cost cap auto-pause),
 *   shows a reason banner to EVERY org member, reflecting in realtime.
 * - Admins get a 1-tap pause (kill-switch) / resume control (SPEC L187:
 *   "1 tap pausa … e reflete na hora").
 *
 * Write authority is the admin-guarded copilot_v2_set_org_pause RPC; this is a
 * thin control surface over useCopilotV2OrgPause.
 */

import { motion } from "framer-motion";
import { AlertTriangle, Power, PlayCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCanManageCopilot, useIdentity } from "@/modules/identity";
import {
  useCopilotV2OrgPause,
  ORG_PAUSE_REASON_LABEL,
} from "@/modules/copilot/hooks/useCopilotV2OrgPause";

export function CopilotOrgKillSwitch({ className }: { className?: string }) {
  const { organizationId } = useIdentity();
  const { canManage } = useCanManageCopilot();
  const { isPaused, reason, pauseOrg, resumeOrg, isMutating } = useCopilotV2OrgPause(organizationId);

  if (!organizationId) return null;

  // Paused → banner for everyone; resume button for admins.
  if (isPaused) {
    const isCostCap = reason === "teto";
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-3",
          isCostCap
            ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
            : "border-destructive/30 bg-destructive/10 text-destructive-foreground",
          className,
        )}
        role="alert"
      >
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">
            Copilot pausado para toda a organização
          </p>
          <p className="text-xs opacity-80">
            Motivo: {reason ? ORG_PAUSE_REASON_LABEL[reason] : "—"}.
            {isCostCap
              ? " Os agentes retomam no próximo ciclo, ou ajuste o teto em Configurações."
              : " Nenhum agente responde até retomar."}
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            disabled={isMutating}
            onClick={() => {
              resumeOrg();
              toast.success("Copilot retomado para a organização.");
            }}
            className="shrink-0 gap-1.5"
          >
            <PlayCircle className="h-4 w-4" />
            Retomar
          </Button>
        )}
      </motion.div>
    );
  }

  // Active + admin → the kill-switch (1-tap). Members see nothing here.
  if (!canManage) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <ShieldAlert className="h-4 w-4" />
        <span className="text-xs">
          Kill-switch — pausa imediata de todos os agentes desta organização.
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={isMutating}
        onClick={() => {
          pauseOrg("takeover");
          toast.success("Copilot pausado para a organização.");
        }}
        className="shrink-0 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Power className="h-4 w-4" />
        Pausar Copilot
      </Button>
    </div>
  );
}
