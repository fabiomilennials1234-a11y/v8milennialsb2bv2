/**
 * InstanceOfflineNotice — inline warning above the composer when the
 * conversation's WhatsApp number is logged out.
 *
 * Without it, the seller typed, hit send and waited ~40 s for "it may have been
 * delivered" (Carol Distribuidora, 2026-11-24). Warn-only by design: the flag
 * can lag a re-pair, and the proxy already refuses a dead-session send at once.
 * Same red pair as SessionDeadBanner (light and dark text both pass AA).
 */
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstanceSessionDead } from "@/modules/communication/hooks/chat/useInstanceSessionDead";

export function InstanceOfflineNotice({ instanceId, className }: { instanceId: string | null | undefined; className?: string }) {
  const dead = useInstanceSessionDead(instanceId);
  // The router is only needed for the CTA: a connected number keeps the
  // composer free of any routing dependency.
  return dead ? <OfflineNotice className={className} /> : null;
}

function OfflineNotice({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div
      role="status"
      className={cn("mb-2 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm", className)}
      data-testid="instance-offline-notice"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-red-800 dark:text-red-50">
        Este número está desconectado. As mensagens não serão enviadas até ele ser reconectado.
      </span>
      <button
        type="button"
        onClick={() => navigate("/configuracoes?tab=whatsapp")}
        className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-red-200"
      >
        Reconectar
      </button>
    </div>
  );
}
