/**
 * RealtimeStatusBadge — status pill in chat header showing connection health.
 *
 * States:
 *   joined          → green  "Ao vivo"
 *   joining         → amber  "Conectando"
 *   reconnecting    → amber  "Reconectando"
 *   errored         → amber  "Reconectando" (falha abaixo do limiar, em backoff)
 *   polling         → orange "Polling"     (circuit breaker tripped)
 *   offline         → red    "Offline"
 *
 * Tooltip shows reason + failure/reconnect counts for diagnostics.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWhatsAppRealtimeStatus } from "@/shared/realtime/useRealtimeChannelStatus";
import type { ChannelStatus } from "@/lib/realtimeStatusStore";

type Variant = "ok" | "pending" | "polling" | "offline";

function classify(
  status: ChannelStatus,
): { variant: Variant; label: string; tooltip: string } {
  switch (status.state) {
    case "joined":
      return {
        variant: "ok",
        label: "Ao vivo",
        tooltip: "Mensagens chegam em tempo real.",
      };
    case "joining":
      return {
        variant: "pending",
        label: "Conectando",
        tooltip: "Estabelecendo conexao de tempo real.",
      };
    case "reconnecting":
    case "errored":
      return {
        variant: "pending",
        label: "Reconectando",
        tooltip: status.lastReason
          ? `Restabelecendo conexao (${status.lastReason}).`
          : "Restabelecendo a conexao.",
      };
    case "polling":
      return {
        variant: "polling",
        label: "Polling",
        tooltip: `Realtime indisponivel apos ${status.consecutiveFailures} falhas. Buscando mensagens periodicamente.`,
      };
    case "offline":
      return {
        variant: "offline",
        label: "Offline",
        tooltip: status.lastReason
          ? `Sem conexao (${status.lastReason}). Atualize a pagina se persistir.`
          : "Sem conexao. Atualize a pagina se persistir.",
      };
    case "unknown":
    default:
      return {
        variant: "pending",
        label: "—",
        tooltip: "Aguardando primeira conexao.",
      };
  }
}

const variantClasses: Record<Variant, string> = {
  ok: "bg-success/10 text-success-strong border-success/25",
  pending: "bg-warning/15 text-warning-strong border-warning/30",
  polling: "bg-warning/15 text-warning-strong border-warning/30",
  offline: "bg-destructive/10 text-destructive border-destructive/25",
};

const dotClasses: Record<Variant, string> = {
  ok: "bg-success",
  pending: "bg-warning animate-pulse",
  polling: "bg-warning animate-pulse",
  offline: "bg-destructive",
};

export function RealtimeStatusBadge({
  organizationId,
  className,
}: {
  organizationId: string | null | undefined;
  className?: string;
}) {
  const status = useWhatsAppRealtimeStatus(organizationId);
  const { variant, label, tooltip } = classify(status);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide select-none",
              variantClasses[variant],
              className,
            )}
            aria-live="polite"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                dotClasses[variant],
              )}
            />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <p>{tooltip}</p>
          {(status.reconnectCount > 0 ||
            status.consecutiveFailures > 0) && (
            <p className="mt-0.5 text-[10px] opacity-70">
              {status.reconnectCount > 0 &&
                `Reconexoes: ${status.reconnectCount}`}
              {status.reconnectCount > 0 &&
                status.consecutiveFailures > 0 &&
                " · "}
              {status.consecutiveFailures > 0 &&
                `Falhas: ${status.consecutiveFailures}`}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
