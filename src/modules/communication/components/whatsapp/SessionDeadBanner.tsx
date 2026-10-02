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
 * ── CONTRASTE (V5) ─────────────────────────────────────────────────────────
 * A tarja nasceu só com a paleta escura (`text-red-50/100/200`) e sumia no
 * tema claro (título em 1.12:1). Depois ganhou pares `x dark:y` de vermelho.
 * No V5 o vermelho fica no que é grande ou gráfico — superfície tintada
 * (`bg-destructive/10`), borda e ícone — e o TEXTO vai em `text-foreground` /
 * `text-muted-foreground`, que passam AA nos dois temas por construção.
 * Não volte a pintar o texto de vermelho: `--destructive` como texto pequeno
 * fica abaixo de 4.5:1 sobre o cartão claro.
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
          "mx-auto flex max-w-[1600px] items-center justify-between gap-4 rounded-2xl border px-4 py-3",
          "border-destructive/30 bg-destructive/10 text-foreground",
          className,
        )}
      >
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-destructive/15 text-destructive">
          <AlertTriangle size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mensagens não estão sendo recebidas. Reescaneie o QR Code para reconectar.
          </p>
        </div>
      </div>

      <Button
        size="sm"
        variant="destructive"
        className="shrink-0"
        onClick={() => navigate("/configuracoes?tab=whatsapp")}
      >
        Reparear agora
        <ArrowRight size={14} className="ml-1.5" />
      </Button>
      </div>
    </div>
  );
}
