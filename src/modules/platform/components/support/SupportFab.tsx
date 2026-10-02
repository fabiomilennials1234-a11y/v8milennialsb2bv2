import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Headset } from "lucide-react";
import { cn } from "@/lib/utils";
import { DockItem, DockOrder } from "@/modules/platform/components/dock/FloatingDock";
import { useSupportUnread } from "@/modules/platform/hooks/useSupportUnread";
import { useSupportPanel } from "./SupportPanelContext";

/**
 * A porta de entrada do Suporte, no dock.
 *
 * V5 (2026-10): deixou de ser o orb dourado de 56px. Ouro é o botão primário
 * do cabeçalho; um segundo ouro fixo no canto competia com ele em toda tela, e
 * os 56px cobriam o "⋯" da última linha de Leads, o enviar da prévia do Copilot
 * e cartões no celular. Agora é uma pílula de TINTA de 44px (branca no escuro,
 * como o `Button variant="ink"`) com o headset em ouro — presença sem disputa.
 *
 * Recolhe enquanto o usuário lê: ao rolar para baixo em qualquer área de
 * rolagem grande, desliza para a borda direita e deixa só uma aba de 12px.
 * Em telas com compositor no canto (chat, prévia do Copilot) já nasce aba.
 * Volta ao rolar para cima, ao chegar no topo, no hover e no foco do teclado.
 * Nunca recolhe com o painel aberto nem com resposta não lida — aí ele é o
 * aviso, e aviso escondido não avisa.
 *
 * Regra de movimento (inalterada): em repouso fica PARADO. Só entra em
 * `attention` — respiração lenta (~3s) + badge verde de contagem — quando há
 * resposta não lida do suporte. A fonte de `attention` é
 * `useSupportUnread().total > 0` (ADR-0018).
 */

/**
 * Telas com compositor ou ação primária presa no canto inferior direito (enviar
 * do chat, enviar da prévia do Copilot, editor de automação). Lá não há rolagem
 * de página para recolher a pílula, então ela já nasce recolhida em aba.
 */
const COMPOSITOR_NO_CANTO = [
  /^\/chat(\/|$)/,
  /^\/chat-whatsapp/,
  /^\/atendimento(\/|$)/,
  /^\/copilot\/(novo|[^/]+\/editar)$/,
  /^\/automacoes\/[^/]+$/,
];

/** Rolagem menor que isto não decide nada — tremor de trackpad. */
const LIMIAR_PX = 6;
/** Perto do topo a pílula sempre aparece. */
const TOPO_PX = 48;

function useRecolheAoRolar(): boolean {
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    // `scroll` não borbulha; na fase de captura o documento vê o de qualquer
    // contêiner — o app rola no <main>, não na janela.
    const ultimo = new WeakMap<Element, number>();
    const aoRolar = (e: Event) => {
      const alvo = e.target === document ? document.scrollingElement : e.target;
      if (!(alvo instanceof Element)) return;
      // Só áreas grandes: lista de Select, popover e carrossel de KPI não contam.
      if (alvo.clientHeight < window.innerHeight * 0.5) return;
      const y = alvo.scrollTop;
      // Contêiner ainda não visto: rolagem começa do topo.
      const antes = ultimo.get(alvo) ?? 0;
      if (Math.abs(y - antes) < LIMIAR_PX) return;
      ultimo.set(alvo, y);
      setRecolhido(y > antes && y > TOPO_PX);
    };
    document.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", aoRolar, { capture: true });
  }, []);

  return recolhido;
}

export function SupportFab() {
  const { open, isOpen } = useSupportPanel();
  const { total } = useSupportUnread();
  const attention = total > 0;
  const rolando = useRecolheAoRolar();
  const { pathname } = useLocation();
  const ancorado = COMPOSITOR_NO_CANTO.some((re) => re.test(pathname));
  const recolhido = (rolando || ancorado) && !isOpen && !attention;

  return (
    <DockItem order={DockOrder.support}>
      <span
        data-recolhido={recolhido}
        className={cn(
          "relative grid place-items-center transition-transform duration-300 ease-drawer motion-reduce:transition-none",
          // Desliza até sobrar 12px visíveis (44px da pílula + 24px do respiro do dock − 12px).
          "data-[recolhido=true]:translate-x-14 data-[recolhido=true]:hover:translate-x-0 data-[recolhido=true]:focus-within:translate-x-0",
          "max-md:data-[recolhido=true]:translate-x-12",
        )}
      >
        {attention && (
          <>
            {/* Respiração: glow suave que pulsa devagar. Calmo, não frenético. */}
            <span
              aria-hidden
              className="pointer-events-none absolute h-14 w-14 rounded-full bg-primary/25 blur-md animate-pulse [animation-duration:3s]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute h-[52px] w-[52px] rounded-full ring-2 ring-primary/50 animate-pulse [animation-duration:3s]"
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
            "relative grid h-11 w-11 place-items-center rounded-full transition-[transform,box-shadow,background-color]",
            "bg-tinta text-primary shadow-relevo-tinta ring-1 ring-tinta-line hover:-translate-y-px hover:bg-tinta-3",
            "dark:bg-foreground dark:text-background dark:ring-0 dark:hover:bg-foreground/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isOpen && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <Headset className="h-5 w-5" aria-hidden />

          {attention && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-success px-1 text-[10px] font-bold text-success-foreground"
            >
              {total > 9 ? "9+" : total}
            </span>
          )}
        </button>
      </span>
    </DockItem>
  );
}
