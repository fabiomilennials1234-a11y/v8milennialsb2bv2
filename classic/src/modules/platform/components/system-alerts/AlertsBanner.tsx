/**
 * Onda 2 Fase E / F-E.6 — Banner de system_alerts ativos
 *
 * Renderiza banner crítico em páginas relevantes (ex: /configuracoes/webhooks
 * mostra alerts categoria=webhook_circuit_breaker). User pode marcar resolvido.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { useSystemAlerts, useResolveAlert } from "@/modules/workflows/hooks/useAutomationHealth";
import { notifyError } from "@/shared/errors";

interface AlertsBannerProps {
  category?: string;
  organizationId?: string;
  className?: string;
}

export function AlertsBanner({ category, organizationId, className }: AlertsBannerProps) {
  const { data: alerts } = useSystemAlerts({ category, organizationId, resolved: false, limit: 5 });
  const resolve = useResolveAlert();

  if (!alerts?.length) return null;

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {alerts.map((alert) => (
        <Alert
          key={alert.id}
          variant={alert.severity === "critical" || alert.severity === "error" ? "destructive" : "default"}
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>{alert.title}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                resolve.mutate(alert.id, {
                  onSuccess: () => toast.success("Alert marcado resolvido"),
                  onError: (e) => notifyError(e, { fallback: "Não foi possível resolver o alerta." }),
                });
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
