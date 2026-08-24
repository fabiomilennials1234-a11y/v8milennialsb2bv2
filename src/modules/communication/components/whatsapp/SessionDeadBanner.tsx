/**
 * SessionDeadBanner — persistent banner shown while any WhatsApp instance in
 * the current org has a dead Uazapi session (logged out from another device,
 * QR timeout, etc.). Populated by `whatsapp-session-watchdog` cron.
 *
 * Mounted inside MainLayout so it surfaces on every authenticated page; it
 * self-hides when there are no dead sessions, so the layout cost is zero in
 * the steady-state.
 *
 * CTA navigates to /configuracoes?tab=whatsapp where the QR re-pair flow lives.
 *
 * ── POR QUE AS CORES VÊM EM PARES `x dark:y` ───────────────────────────────
 * A tarja nasceu só com a paleta escura (`text-red-50/100/200` sobre
 * `bg-red-500/10`). Isso é legível sobre preto e some sobre branco: no tema
 * claro o título ficava em 1.12:1 e o botão em 1.26:1 — o alerta mais urgente
 * do produto, invisível justamente para quem usa o tema claro. Só o ícone
 * (`text-red-400`, 2.26:1) insinuava que havia algo ali.
 *
 * A superfície translúcida (`bg-red-500/10`) funciona nos dois temas e ficou.
 * O que passou a variar por tema é o TEXTO, no mesmo idioma do resto do repo
 * (`text-red-600 dark:text-red-300`). Medido depois: claro 6.78 / 4.65 / 6.04,
 * escuro inalterado em 17.92 / 8.82 / 16.32.
 *
 * Ao mexer aqui, mexa nos dois lados do par — trocar só a cor crua reintroduz
 * exatamente este bug.
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
          "bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-100",
          className,
        )}
      >
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle size={18} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-800 dark:text-red-50">{label}</p>
          <p className="text-xs text-red-700/90 dark:text-red-200/80 mt-0.5">
            Mensagens não estão sendo recebidas. Reescaneie o QR Code para reconectar.
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-red-500/40 bg-red-500/10 text-red-800 hover:bg-red-500/20 hover:text-red-900 dark:border-red-400/40 dark:text-red-50 dark:hover:text-white"
        onClick={() => navigate("/configuracoes?tab=whatsapp")}
      >
        Reparear agora
        <ArrowRight size={14} className="ml-1.5" />
      </Button>
      </div>
    </div>
  );
}
