import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useAuth } from "@/modules/identity";
import { cn } from "@/lib/utils";
import {
  isAppSettled,
  markCoachDone,
  markEngaged,
  readSessionShown,
  readState,
  recordModalShown,
  shouldShowModal,
  SUPPORT_FAB_SELECTOR,
} from "@/modules/platform/lib/support-announcement";
import { useSupportPanel } from "./SupportPanelContext";

/**
 * Anúncio de lançamento da Central de Suporte: modal de entrada (A) + coach-mark
 * apontando o FAB "?" do dock (C). Toda a política de exibição vive em
 * `lib/support-announcement.ts` (pura, testada); aqui é só orquestração + visual.
 *
 * O anúncio só existe onde o FAB existe (`[data-support-fab]` no DOM) — em telas
 * fullbleed/TV/login nada renderiza. Abrir o suporte por qualquer via, a qualquer
 * momento, marca engajamento e mata o anúncio pra sempre.
 */

type Phase = "idle" | "modal" | "coach" | "done";

const ENTRY_DELAY_MS = 800;
const SETTLE_POLL_MS = 250;
const FAB_SELECTOR = SUPPORT_FAB_SELECTOR;

/** Accent gold do design system, com alpha — pra gradientes/glows inline. */
const gold = (alpha: number) => `hsl(47 100% 50% / ${alpha})`;

export function SupportAnnouncement() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { isOpen, open } = useSupportPanel();

  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  // Entrada por espera de condição: o app precisa estar "assentado" (FAB no DOM
  // e nenhum TorqueLoader na tela — ver isAppSettled) antes do modal aparecer.
  // Um timer fixo abria o modal por cima do loader de chunk/auth — ou, se o FAB
  // ainda não existia aos 800ms, desistia e o anúncio morria pra sessão.
  useEffect(() => {
    if (!userId) return;

    let intervalId: number | null = null;
    let delayId: number | null = null;

    // Encerramento definitivo: modal exibido, inelegível, ou unmount (cleanup).
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (delayId !== null) {
        window.clearTimeout(delayId);
        delayId = null;
      }
    };

    const tick = () => {
      if (delayId !== null) return; // assentou — aguardando o delay de entrada
      if (phaseRef.current !== "idle") {
        stop();
        return;
      }
      if (!shouldShowModal(readState(userId), readSessionShown())) {
        stop();
        return;
      }
      if (isOpenRef.current) return; // suporte aberto — o effect abaixo engaja
      if (!isAppSettled(document)) return; // ainda carregando — segue esperando

      // Assentou: segura ENTRY_DELAY_MS e re-checa tudo antes de exibir — um
      // chunk pode ter começado a carregar (loader de volta) nesse meio-tempo.
      delayId = window.setTimeout(() => {
        delayId = null;
        if (phaseRef.current !== "idle") {
          stop();
          return;
        }
        if (!shouldShowModal(readState(userId), readSessionShown())) {
          stop();
          return;
        }
        if (isOpenRef.current || !isAppSettled(document)) return; // volta ao polling
        stop();
        recordModalShown(userId);
        setPhase("modal");
      }, ENTRY_DELAY_MS);
    };

    intervalId = window.setInterval(tick, SETTLE_POLL_MS);
    tick();
    return stop;
  }, [userId]);

  // Abrir o suporte por qualquer via = engajou. Anúncio ativo some na hora.
  useEffect(() => {
    if (!isOpen || !userId) return;
    if (!readState(userId).engaged) markEngaged(userId);
    if (phaseRef.current === "modal" || phaseRef.current === "coach") setPhase("done");
  }, [isOpen, userId]);

  // Fechar o modal por qualquer via que não o CTA → coach-mark (se ainda devido).
  const dismissModal = useCallback(() => {
    if (!userId) return;
    setPhase(readState(userId).coachDone ? "done" : "coach");
  }, [userId]);

  // CTA "Conhecer o Suporte": engaja, pula o coach e abre o painel.
  const engage = useCallback(() => {
    if (!userId) return;
    markEngaged(userId);
    setPhase("done");
    open();
  }, [userId, open]);

  // "Entendi" — nunca mais.
  const finishCoach = useCallback(() => {
    if (userId) markCoachDone(userId);
    setPhase("done");
  }, [userId]);

  // "Pular" / Esc / FAB sumiu — só nesta sessão; volta se o modal reaparecer.
  const skipCoach = useCallback(() => {
    setPhase("done");
  }, []);

  if (!userId) return null;

  return (
    <>
      <AnnouncementModal open={phase === "modal"} onEngage={engage} onDismiss={dismissModal} />
      {phase === "coach" && <SupportCoachMark onDone={finishCoach} onSkip={skipCoach} />}
    </>
  );
}

/* ────────────────────────── Modal A ────────────────────────── */

const BULLETS = [
  "Abra um chamado em segundos, com print e tudo",
  "Acompanhe a resposta em tempo real, no mesmo lugar",
  // O aviso de resposta chega como badge no próprio FAB (useSupportUnread) —
  // o sininho de alertas não cobre suporte.
  "Aviso no ? dourado quando a gente responder",
];

function AnnouncementModal({
  open,
  onEngage,
  onDismiss,
}: {
  open: boolean;
  onEngage: () => void;
  onDismiss: () => void;
}) {
  const ctaRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
            "duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            ctaRef.current?.focus();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-2xl border border-border bg-card text-card-foreground",
            "shadow-[0_32px_80px_-12px_rgba(0,0,0,0.85)]",
            "duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "focus:outline-none",
          )}
        >
          {/* Header ilustrado: o "?" dourado do dock, em destaque. */}
          <div
            className="relative h-[148px] border-b border-border/60"
            style={{
              background: `radial-gradient(circle at 28% 18%, ${gold(0.1)}, transparent 55%), radial-gradient(circle at 78% 85%, ${gold(0.07)}, transparent 50%)`,
            }}
          >
            <span className="absolute right-4 top-4 rounded-full bg-primary px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
              Novo
            </span>
            <div className="grid h-full place-items-center">
              <div
                aria-hidden
                className="grid h-[74px] w-[74px] place-items-center rounded-full border border-primary/45 bg-primary/[0.12] text-[30px] font-bold text-primary"
                style={{
                  boxShadow: `0 0 0 14px ${gold(0.05)}, 0 0 0 28px ${gold(0.025)}`,
                }}
              >
                ?
              </div>
            </div>
          </div>

          <div className="px-6 pt-5">
            <DialogPrimitive.Title className="text-[19px] font-bold leading-snug tracking-tight">
              Precisou de ajuda? Agora é aqui dentro.
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              Chegou a Central de Suporte do Torque. Abra chamados, acompanhe respostas e resolva
              tudo sem sair do CRM.
            </DialogPrimitive.Description>

            <ul className="mt-4 space-y-2.5">
              {BULLETS.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2.5 text-[13px] text-foreground/90">
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary"
                  >
                    ✓
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-2.5 px-6 pb-6 pt-5">
            <button
              ref={ctaRef}
              type="button"
              onClick={onEngage}
              className={cn(
                "h-10 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              Conhecer o Suporte
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className={cn(
                "h-10 rounded-lg border border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              Agora não
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ──────────────────────── Coach-mark C ──────────────────────── */

/** Folga entre a borda do FAB e a do furo do spotlight. */
const SPOTLIGHT_PADDING = 6;
/** Distância entre o balão e o FAB. */
const BALLOON_GAP = 16;
/** Metade da diagonal visível da seta losango de 11px. */
const ARROW_HALF = 5.5;

const PULSE_CSS = `
@keyframes support-coach-pulse {
  0% { transform: scale(0.92); opacity: 0.9; }
  70%, 100% { transform: scale(1.28); opacity: 0; }
}
@media (prefers-reduced-motion: no-preference) {
  .support-coach-pulse-ring { animation: support-coach-pulse 2.2s ease-out infinite; }
}
@media (prefers-reduced-motion: reduce) {
  .support-coach-pulse-ring { opacity: 0.5; }
}
`;

function SupportCoachMark({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [fabRect, setFabRect] = useState<DOMRect | null>(null);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 639px)").matches,
  );

  // Mede o FAB e re-mede em resize. FAB sumiu do DOM → desmonta (skip de sessão).
  useEffect(() => {
    const measure = () => {
      const fab = document.querySelector<HTMLElement>(FAB_SELECTOR);
      if (!fab) {
        onSkip();
        return;
      }
      setFabRect(fab.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [onSkip]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Esc = Pular (fecha só nesta sessão).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);

  if (!fabRect) return null;

  const centerX = fabRect.left + fabRect.width / 2;
  const radius = Math.max(fabRect.width, fabRect.height) / 2 + SPOTLIGHT_PADDING;

  // Desktop: balão à esquerda do FAB, base alinhada à base do botão (o FAB vive
  // colado no rodapé — centralizar verticalmente furaria a viewport).
  // Mobile: balão acima do FAB, encostado à direita sem furar a viewport.
  const balloonStyle: CSSProperties = isMobile
    ? {
        bottom: window.innerHeight - fabRect.top + BALLOON_GAP,
        right: Math.max(16, window.innerWidth - fabRect.right),
      }
    : {
        right: window.innerWidth - fabRect.left + BALLOON_GAP,
        bottom: window.innerHeight - fabRect.bottom,
      };

  const arrowStyle: CSSProperties = isMobile
    ? {
        bottom: -ARROW_HALF,
        right: Math.max(
          12,
          window.innerWidth -
            centerX -
            Math.max(16, window.innerWidth - fabRect.right) -
            ARROW_HALF,
        ),
      }
    : { right: -ARROW_HALF, bottom: fabRect.height / 2 - ARROW_HALF };

  return createPortal(
    <>
      <style>{PULSE_CSS}</style>

      {/* Spotlight: furo circular sobre o FAB. pointer-events-none — o FAB
          continua clicável, e clicar nele abre o suporte (= engajou). */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[60] rounded-full"
        style={{
          left: centerX - radius,
          top: fabRect.top + fabRect.height / 2 - radius,
          width: radius * 2,
          height: radius * 2,
          boxShadow: "0 0 0 9999px rgba(10,9,7,0.6)",
        }}
      >
        <div className="support-coach-pulse-ring absolute inset-0 rounded-full border-2 border-primary/55" />
      </div>

      <div
        role="dialog"
        aria-label="Novidade: Central de Suporte"
        className={cn(
          "fixed z-[61] w-[300px] rounded-xl border border-border bg-card p-4 text-card-foreground",
          "shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)]",
          "max-sm:w-[min(280px,calc(100vw-2rem))]",
        )}
        style={balloonStyle}
      >
        <span
          aria-hidden
          className={cn(
            "absolute h-[11px] w-[11px] rotate-45 border-border bg-card",
            isMobile ? "border-b border-r" : "border-r border-t",
          )}
          style={arrowStyle}
        />

        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
          Novidade · Suporte
        </p>
        <h4 className="mt-1 text-[15px] font-bold leading-snug tracking-tight">
          Esse dourado aqui é o seu Suporte
        </h4>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Qualquer dúvida ou problema, clique no{" "}
          <strong className="font-semibold text-foreground">?</strong> pra abrir um chamado. A
          resposta chega aqui mesmo — sem e-mail, sem grupo de WhatsApp.
        </p>

        <div className="mt-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Pular
          </button>
          <button
            type="button"
            onClick={onDone}
            className={cn(
              "h-8 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            Entendi
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
