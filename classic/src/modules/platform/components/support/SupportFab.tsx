import { Headset } from "lucide-react";
import { cn } from "@/lib/utils";
import { DockItem, DockOrder } from "@/modules/platform/components/dock/FloatingDock";
import { useSupportUnread } from "@/modules/platform/hooks/useSupportUnread";
import { useSupportPanel } from "./SupportPanelContext";

/**
 * A porta de entrada do Suporte, no dock — orb gold sólido.
 *
 * O "?" dourado resolvia contraste, mas ainda era um botão discreto. Aqui vira um
 * orb sólido `bg-primary` de 56px com o ícone de headset: presença de canal de
 * atendimento, não um ponto de ajuda passivo.
 *
 * Regra de movimento: em repouso fica PARADO. Só entra em `attention` — respiração
 * lenta (~3s, `animate-pulse` num glow suave, nunca o ping seco) + badge verde de
 * contagem — quando há resposta não lida do suporte. O movimento vira sinal, não
 * ruído. A fonte de `attention` é `useSupportUnread().total > 0`: o badge é a
 * metade visível do loop de volta, é aqui que o cliente descobre que o suporte
 * respondeu (ADR-0018).
 */
export function SupportFab() {
  const { open, isOpen } = useSupportPanel();
  const { total } = useSupportUnread();
  const attention = total > 0;

  return (
    <DockItem order={DockOrder.support}>
      <span className="relative grid place-items-center">
        {attention && (
          <>
            {/* Respiração: glow suave que pulsa devagar. Calmo, não frenético. */}
            <span
              aria-hidden
              className="pointer-events-none absolute h-16 w-16 rounded-full bg-primary/25 blur-md animate-pulse [animation-duration:3s]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute h-14 w-14 rounded-full ring-2 ring-primary/40 animate-pulse [animation-duration:3s]"
            />
          </>
        )}
        <button
          type="button"
          data-support-fab
          onClick={open}
          aria-label={
            attention
              ? `Ajuda — ${total} resposta${total > 1 ? "s" : ""} não lida${total > 1 ? "s" : ""}`
              : "Ajuda"
          }
          title="Ajuda"
          className={cn(
            "relative grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground transition",
            "shadow-xl shadow-primary/40 hover:scale-105",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isOpen && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
          )}
        >
          <Headset className="h-6 w-6" aria-hidden />

          {attention && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full border-2 border-background bg-emerald-500 px-1 text-[10px] font-bold text-white"
            >
              {total > 9 ? "9+" : total}
            </span>
          )}
        </button>
      </span>
    </DockItem>
  );
}
