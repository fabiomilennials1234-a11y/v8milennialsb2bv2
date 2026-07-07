/**
 * SessionDeadBanner — persistent banner shown while any WhatsApp instance in
 * the current org has a dead Uazapi session (logged out from another device,
 * QR timeout, etc.). Populated by `whatsapp-session-watchdog` cron.
 *
 * Mounted inside MainLayout so it surfaces on every authenticated page; it
 * self-hides when there are no dead sessions, so the layout cost is zero in
 * the steady-state.
 *
 * CTA navigates to /configuracoes (aba WhatsApp) where the QR re-pair flow lives.
 */
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDeadSessions } from "@/modules/communication/hooks/useDeadSessions";

function formatPhone(raw: string | null): string {
  if (!raw) return "sem número";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 5)} ${digits.slice(5, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return raw;
}

export function SessionDeadBanner({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { data: deadSessions } = useDeadSessions();

  if (!deadSessions || deadSessions.length === 0) return null;

  const count = deadSessions.length;
  const first = deadSessions[0];
  const label =
    count === 1
      ? `${first.instance_name} (${formatPhone(first.phone_number)}) está desconectado`
      : `${count} números do WhatsApp estão desconectados`;

  return (
    <div className="px-4 pt-3">
      <div
        role="alert"
        aria-live="polite"
        className={cn(
          "mx-auto max-w-[1600px] flex items-center justify-between gap-4 rounded-lg border px-4 py-3",
          "bg-red-500/10 border-red-500/30 text-red-100",
          className,
        )}
      >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle size={18} className="shrink-0 text-red-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-50">{label}</p>
          <p className="text-xs text-red-200/80 mt-0.5">
            Mensagens não estão sendo recebidas. Reescaneie o QR Code para reconectar.
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-red-400/40 bg-red-500/10 text-red-50 hover:bg-red-500/20 hover:text-white"
        onClick={() => navigate("/configuracoes?tab=whatsapp")}
      >
        Reparear agora
        <ArrowRight size={14} className="ml-1.5" />
      </Button>
      </div>
    </div>
  );
}
