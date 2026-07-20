import { useState, type ReactNode } from "react";
import { Zap, BellRing, LifeBuoy, ArrowRight } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupportPanel } from "@/modules/platform/components/support/SupportPanelContext";
import { SupportRealtimeChatDemo } from "./SupportRealtimeChatDemo";

/**
 * O takeover de LANÇAMENTO (variação 03). Aparece uma vez por navegador na estreia
 * da feature. Split: à esquerda a promessa + os três ganhos; à direita a conversa
 * ao vivo em ação. O CTA abre um chamado novo direto.
 */
export function SupportRealtimeLaunchModal({ onClose }: { onClose: () => void }) {
  const { openNewTicket } = useSupportPanel();
  // Estado próprio de visibilidade: o Dialog é controlado, então sem isto o
  // `open` fixo em `true` mantinha o takeover na tela mesmo depois do X/Esc —
  // `onClose` só persistia no storage e o modal só sumia com um reload.
  const [open, setOpen] = useState(true);

  const dismiss = () => {
    setOpen(false);
    onClose();
  };

  const startTicket = () => {
    setOpen(false);
    onClose();
    openNewTicket();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="grid max-w-3xl gap-0 overflow-hidden p-0 sm:grid-cols-[1.05fr_1fr]">
        <div className="p-7 sm:p-8">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
            Lançamento
          </span>

          <h2 className="mt-3.5 text-balance text-[26px] font-semibold leading-tight tracking-tight">
            Suporte, agora em tempo real
          </h2>
          <p className="mt-2.5 max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
            Precisou de ajuda? Abra um chamado dentro do Torque e converse com o
            nosso time ao vivo.
          </p>

          <ul className="mt-6 flex flex-col gap-3.5">
            <Feature
              icon={<Zap className="h-4 w-4" />}
              title="Resposta na hora"
              desc="A conversa atualiza sozinha, sem apertar F5."
            />
            <Feature
              icon={<BellRing className="h-4 w-4" />}
              title="Avisa quando responderem"
              desc="Um selo acende assim que o suporte responde."
            />
            <Feature
              icon={<LifeBuoy className="h-4 w-4" />}
              title="Sempre à mão"
              desc="Abra pelo ícone de suporte, a qualquer momento."
            />
          </ul>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Button onClick={startTicket} className="gap-2">
              Abrir meu primeiro chamado
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={dismiss}>
              Explorar depois
            </Button>
          </div>
        </div>

        <div className="hidden items-center border-l border-border bg-muted/30 p-6 sm:flex">
          <div className="w-full">
            <SupportRealtimeChatDemo />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-primary/15 text-primary">
        {icon}
      </span>
      <div>
        <b className="block text-[13.5px] font-semibold">{title}</b>
        <span className="text-[12.5px] leading-snug text-muted-foreground">{desc}</span>
      </div>
    </li>
  );
}
