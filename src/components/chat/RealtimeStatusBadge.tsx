/**
 * RealtimeStatusBadge — small status pill rendered in the chat header that
 * surfaces whether the live WhatsApp message stream is healthy. Sourced from
 * realtimeStatusStore, populated by useWhatsAppMessagesRealtime.
 *
 * States:
 *   joined / unknown  → 🟢 ao vivo
 *   joining           → 🟡 conectando
 *   stale / reconnecting → 🟡 reconectando
 *   offline           → 🔴 offline (manual refresh sugerido)
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWhatsAppRealtimeStatus } from "@/hooks/useRealtimeChannelStatus";

type Variant = "ok" | "pending" | "offline";

function classify(state: string): { variant: Variant; label: string; tooltip: string } {
  switch (state) {
    case "joined":
      return { variant: "ok", label: "Ao vivo", tooltip: "Mensagens chegam em tempo real." };
    case "joining":
      return { variant: "pending", label: "Conectando", tooltip: "Estabelecendo conexão de tempo real." };
    case "stale":
      return { variant: "pending", label: "Sincronizando", tooltip: "Sem eventos há mais de 1 min — reconectando." };
    case "reconnecting":
      return { variant: "pending", label: "Reconectando", tooltip: "Restabelecendo a conexão." };
    case "offline":
      return { variant: "offline", label: "Offline", tooltip: "Sem conexão em tempo real. Atualize a página se persistir." };
    case "unknown":
    default:
      return { variant: "pending", label: "—", tooltip: "Aguardando primeira conexão." };
  }
}

const variantClasses: Record<Variant, string> = {
  ok: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  offline: "bg-red-500/15 text-red-400 border-red-500/30",
};

const dotClasses: Record<Variant, string> = {
  ok: "bg-emerald-400",
  pending: "bg-amber-400 animate-pulse",
  offline: "bg-red-400",
};

export function RealtimeStatusBadge({
  organizationId,
  className,
}: {
  organizationId: string | null | undefined;
  className?: string;
}) {
  const status = useWhatsAppRealtimeStatus(organizationId);
  const { variant, label, tooltip } = classify(status.state);

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
            <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[variant])} />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {tooltip}
          {status.reconnectCount > 0 && (
            <span className="block text-[10px] opacity-70 mt-0.5">
              Reconexões na sessão: {status.reconnectCount}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
