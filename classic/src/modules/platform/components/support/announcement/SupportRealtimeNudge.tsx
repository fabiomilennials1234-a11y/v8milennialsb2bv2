import { useState } from "react";
import { X, Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupportPanel } from "@/modules/platform/components/support/SupportPanelContext";

/**
 * O COACH-MARK (variação 02). Card discreto no canto, ancorado sobre o dock de
 * suporte, com um pulso gold apontando para o ícone. Aparece a cada entrada (uma
 * vez por sessão); o X o desliga em definitivo.
 */
export function SupportRealtimeNudge({
  onDismissForever,
}: {
  onDismissForever: () => void;
}) {
  const [open, setOpen] = useState(true);
  const { openNewTicket } = useSupportPanel();

  if (!open) return null;

  const dismiss = () => {
    setOpen(false);
    onDismissForever();
  };

  const startTicket = () => {
    setOpen(false);
    openNewTicket();
  };

  return (
    <div
      role="dialog"
      aria-label="Novidade: suporte ao vivo"
      className="fixed bottom-[6.5rem] right-6 z-50 w-[320px] rounded-2xl border border-border bg-card/95 p-4 shadow-xl shadow-black/30 backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dispensar"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border border-border bg-muted/60 text-muted-foreground transition hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
        Novo
      </span>

      <h3 className="mt-2 flex items-center gap-2 text-[17px] font-semibold tracking-tight">
        <Headset className="h-4 w-4 text-primary" aria-hidden />
        Suporte ao vivo
      </h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        Abra um chamado por aqui e receba resposta em tempo real — a conversa
        atualiza sozinha.
      </p>

      <div className="mt-3.5 flex items-center gap-2">
        <Button size="sm" onClick={startTicket}>
          Abrir chamado
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Agora não
        </Button>
      </div>

      {/* Ponteiro para o dock de suporte, logo abaixo à direita. */}
      <span
        aria-hidden
        className="absolute -bottom-1.5 right-8 h-3 w-3 rotate-45 border-b border-r border-border bg-card"
      />
    </div>
  );
}
