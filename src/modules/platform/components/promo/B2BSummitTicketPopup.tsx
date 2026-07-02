/**
 * B2BSummitTicketPopup — pop-up promocional "bilhete dourado" (Willy Wonka) do B2B Summit.
 *
 * Sequência: barra de chocolate cai na tela → bilhete dourado espia pra fora e espera
 * o clique do cliente (puxão) → barra cai e o ticket cresce. Fallback de 8s pra quem
 * não interage. Clique no backdrop ou Esc durante a intro pulam pro ticket (não fecham).
 *
 * Aparece 1x por browser (localStorage — não cruza devices; aceito pra promo temporária).
 * Cupom rotacionado 50/50 (FINKLER | MARCELO), persistido por usuário — o CTA abre o
 * checkout do parceiro com ?cupom= já aplicado. Temporário — remover após o evento.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MapPin, CalendarDays, Ticket, Crown, Copy, Check } from "lucide-react";

// Compra do ingresso — ?cupom= aplica o desconto direto no checkout do parceiro.
const TICKET_PURCHASE_BASE_URL =
  "https://www.pensanoevento.com.br/sitev2/eventos/104700/b2b-summit-brasil-2026";
const EVENT_DATE_LABEL: string = "23 jul 2026";

// Arte oficial do evento (public/) — carrega só quando o popup abre.
const EVENT_ART_URL = "/promo/b2b-summit-2026.jpg";

const STORAGE_KEY = "b2b-summit-2026-ticket-dismissed";
const COUPON_KEY = "b2b-summit-2026-coupon";
// Cupom salvo fora desta lista é re-sorteado (troca de cupom em campanha viva é segura).
const COUPONS = ["FINKLER", "MARCELO"] as const;
const ENTRY_DELAY_MS = 900;
// Intro: barra entra → bilhete espia e espera o puxão do cliente (com fallback)
const BAR_PHASE_MS = 1100;
const PULL_MS = 520;
const REVEAL_FALLBACK_MS = 8000;

type Phase = "bar" | "reveal" | "pull" | "ticket";

/** Sorteia 50/50 na primeira exibição e persiste — o cupom copiado tem que ser o aplicado. */
function resolveCoupon(): string {
  const saved = localStorage.getItem(COUPON_KEY);
  if (saved && (COUPONS as readonly string[]).includes(saved)) return saved;
  const drawn = COUPONS[Math.random() < 0.5 ? 0 : 1];
  localStorage.setItem(COUPON_KEY, drawn);
  return drawn;
}

const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 137.5) % 100,
  delay: (i % 6) * 0.45,
  duration: 2.8 + (i % 5) * 0.5,
  size: 5 + (i % 3) * 3,
  hue: [47, 36, 51, 42][i % 4],
  drift: i % 2 === 0 ? 1 : -1,
}));

const INK = "hsl(28 62% 13%)"; // tinta chocolate gravada no foil
const INK_SOFT = "hsl(28 58% 15%)"; // microcopy — contraste mínimo sobre a zona escura do foil
const GOLD_FOIL =
  "linear-gradient(112deg, hsl(36 65% 38%) 0%, hsl(43 82% 52%) 18%, hsl(50 95% 72%) 38%, hsl(46 90% 58%) 55%, hsl(50 96% 76%) 72%, hsl(42 80% 50%) 88%, hsl(35 62% 36%) 100%)";

function PriceRow({
  icon,
  label,
  badge,
  original,
  final,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  original?: string;
  final: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="relative flex items-center justify-between gap-2 rounded-md px-3.5 py-2"
      style={{
        border: `1px solid ${highlight ? "hsl(28 55% 18% / .55)" : "hsl(28 55% 18% / .28)"}`,
        background: highlight ? "hsl(28 60% 13% / .10)" : "hsl(50 100% 92% / .18)",
      }}
    >
      {badge && (
        <span
          className="absolute -top-[9px] right-3 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
          style={{ background: "hsl(50 100% 55%)", color: INK }}
        >
          {badge}
        </span>
      )}
      <span
        className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold"
        style={{ color: INK }}
      >
        {icon}
        {label}
      </span>
      <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
        {original && (
          <span className="text-xs line-through" style={{ color: "hsl(28 45% 24%)" }}>
            {original}
          </span>
        )}
        <span className="text-base font-black tabular-nums" style={{ color: INK }}>
          {final}
        </span>
      </span>
    </div>
  );
}

/** Barra de chocolate Wonka-style — fase de intro. O clique puxa o bilhete. */
function WonkaBar({ phase, onPull }: { phase: Phase; onPull: () => void }) {
  const pullable = phase === "reveal";
  return (
    <div className="b2b-bar-scale">
      <div
        className={`b2b-bar-in relative ${pullable ? "cursor-grab active:cursor-grabbing" : ""}`}
        onClick={(e) => {
          if (!pullable) return;
          e.stopPropagation();
          onPull();
        }}
      >
        {/* Bilhete dourado saindo de dentro do embrulho (z abaixo da barra).
            Texto alinhado à direita — é a parte que fica exposta no peek. */}
        <button
          className={`b2b-focus-ink absolute inset-y-[14%] left-[6%] flex w-[82%] items-center justify-end rounded-sm pr-4 transition-[filter] hover:brightness-110 ${
            phase === "reveal" ? "b2b-mini-peek" : phase === "pull" ? "b2b-mini-pull" : ""
          }`}
          style={{ background: GOLD_FOIL, zIndex: 0, boxShadow: "0 4px 18px hsl(43 90% 50% / .5)" }}
          aria-label="Puxar o bilhete dourado"
          tabIndex={pullable ? 0 : -1}
        >
          <span
            className="b2b-serif whitespace-nowrap text-[10px] font-black uppercase tracking-[0.22em] max-sm:hidden"
            style={{ color: INK }}
          >
            ✦ Bilhete Dourado ✦
          </span>
        </button>

        {/* Corpo da barra — embrulho marrom com frame vermelho */}
        <div
          className={`relative flex h-[150px] w-[min(430px,78vw)] flex-col items-center justify-center rounded-[4px] px-6 ${
            phase === "pull" ? "b2b-bar-exit" : ""
          }`}
          style={{
            zIndex: 1,
            background:
              "linear-gradient(160deg, hsl(14 48% 26%) 0%, hsl(16 45% 20%) 55%, hsl(14 50% 15%) 100%)",
            border: "5px solid hsl(5 72% 42%)",
            boxShadow: "0 22px 50px -16px rgb(0 0 0 / .85), inset 0 0 0 1px hsl(40 60% 80% / .25)",
          }}
        >
          {/* Selo "GANHE R$ 50" — estrela amarela */}
          <div
            className="absolute left-3 top-3 flex h-14 w-14 rotate-[-14deg] items-center justify-center text-center"
            style={{
              background: "hsl(50 100% 55%)",
              color: "hsl(10 70% 30%)",
              clipPath:
                "polygon(50% 0%, 61% 12%, 76% 6%, 79% 22%, 95% 25%, 88% 39%, 100% 50%, 88% 61%, 95% 75%, 79% 78%, 76% 94%, 61% 88%, 50% 100%, 39% 88%, 24% 94%, 21% 78%, 5% 75%, 12% 61%, 0% 50%, 12% 39%, 5% 25%, 21% 22%, 24% 6%, 39% 12%)",
            }}
          >
            <span className="text-[9px] font-black uppercase leading-[1.15]">
              Ganhe
              <br />
              R$ 50
            </span>
          </div>

          <div
            className="b2b-script text-5xl font-bold italic leading-none text-white"
            style={{ textShadow: "2px 3px 0 hsl(14 50% 12%), 4px 6px 12px rgb(0 0 0 / .4)" }}
          >
            B2B Summit
          </div>
          <div
            className="b2b-script mt-2 text-lg italic"
            style={{ color: "hsl(8 80% 58%)", textShadow: "1px 1px 0 hsl(14 50% 12%)" }}
          >
            Surpresa Crocante Dourada
          </div>

          {/* Ponta rasgada do embrulho — foil dourado aparecendo */}
          <div
            className="absolute inset-y-[10%] right-[-13px] w-[26px]"
            style={{
              background: GOLD_FOIL,
              clipPath:
                "polygon(0 0, 100% 8%, 62% 16%, 100% 27%, 58% 36%, 100% 47%, 60% 57%, 100% 68%, 58% 77%, 100% 88%, 0 100%)",
              zIndex: -1,
            }}
            aria-hidden
          />
        </div>

        <div
          className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-white/60"
          style={{ transform: "rotate(8deg)" }}
        >
          {phase === "bar"
            ? "Você ganhou uma surpresa…"
            : phase === "reveal"
              ? "Puxe o bilhete dourado ✦"
              : "…!"}
        </div>
      </div>
    </div>
  );
}

export function B2BSummitTicketPopup({ forceOpen = false }: { forceOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [phase, setPhase] = useState<Phase>("bar");
  const [coupon, setCoupon] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const tiltRef = useRef<HTMLDivElement>(null);

  /** Tilt 3D + brilho seguindo o cursor — foil reagindo à luz. Desktop only. */
  const onTiltMove = useCallback((e: React.MouseEvent) => {
    const el = tiltRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce), (pointer: coarse)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transform = `rotateY(${(x - 0.5) * 5}deg) rotateX(${-(y - 0.5) * 3.5}deg)`;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  }, []);

  const onTiltLeave = useCallback(() => {
    const el = tiltRef.current;
    if (el) el.style.transform = "";
  }, []);

  const startIntro = useCallback(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setPhase("ticket");
      return;
    }
    setPhase("bar");
    // Para em "reveal" e espera o puxão; fallback abre o ticket pra quem não interage.
    timers.current.push(setTimeout(() => setPhase("reveal"), BAR_PHASE_MS));
    timers.current.push(
      setTimeout(
        () => setPhase((p) => (p === "reveal" ? "ticket" : p)),
        BAR_PHASE_MS + REVEAL_FALLBACK_MS
      )
    );
  }, []);

  const pull = useCallback(() => {
    setPhase((p) => {
      if (p !== "reveal") return p;
      timers.current.push(setTimeout(() => setPhase("ticket"), PULL_MS));
      return "pull";
    });
  }, []);

  const skipIntro = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setPhase("ticket");
  }, []);

  useEffect(() => {
    if (forceOpen) {
      setCoupon(resolveCoupon());
      setOpen(true);
      startIntro();
      return () => timers.current.forEach(clearTimeout);
    }
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = setTimeout(() => {
      setCoupon(resolveCoupon());
      setOpen(true);
      startIntro();
    }, ENTRY_DELAY_MS);
    return () => {
      clearTimeout(t);
      timers.current.forEach(clearTimeout);
    };
  }, [forceOpen, startIntro]);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setOpen(false);
      setLeaving(false);
      if (!forceOpen) localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }, 220);
  }, [forceOpen]);

  /** Backdrop: durante a intro pula pro bilhete (não fecha); no bilhete, fecha. */
  const onOverlayClick = useCallback(() => {
    if (phase === "pull") return; // puxão em andamento — deixa terminar
    if (phase !== "ticket") {
      skipIntro();
      return;
    }
    close();
  }, [phase, skipIntro, close]);

  // Foco: guarda o anterior, trava scroll do body, foca o dialog; restaura ao fechar.
  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      prevFocus.current?.focus?.();
    };
  }, [open]);

  // Payoff: foco vai pro CTA de compra assim que o ticket aparece.
  useEffect(() => {
    if (open && phase === "ticket") ctaRef.current?.focus();
  }, [open, phase]);

  // Esc durante a intro NÃO fecha (não queima a campanha) — pula pro ticket. Tab: trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (phase !== "ticket") skipIntro();
        else close();
        return;
      }
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, skipIntro, close]);

  const copyCoupon = useCallback(() => {
    navigator.clipboard?.writeText(coupon).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [coupon]);

  const buy = useCallback(() => {
    const url = `${TICKET_PURCHASE_BASE_URL}?cupom=${encodeURIComponent(coupon)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    close();
  }, [coupon, close]);

  if (!open) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Bilhete dourado — R$50 de desconto no B2B Summit"
      tabIndex={-1}
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 outline-none ${
        leaving ? "b2b-overlay-out" : "b2b-overlay-in"
      }`}
      style={{ background: "hsl(25 30% 3% / 0.82)", backdropFilter: "blur(6px)" }}
      onClick={onOverlayClick}
    >
      {/* Backdrop cinematográfico — arte oficial do evento, desfocada atrás do bilhete */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <img
          src={EVENT_ART_URL}
          alt=""
          className="h-full w-full object-cover"
          style={{
            opacity: 0.22,
            filter: "blur(14px) brightness(0.75) saturate(1.15)",
            transform: "scale(1.12)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 45%, transparent 0%, hsl(25 30% 3% / .85) 78%)",
          }}
        />
      </div>
      <style>{`
        @keyframes b2b-overlay-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes b2b-overlay-out { from { opacity: 1 } to { opacity: 0 } }
        .b2b-overlay-in { animation: b2b-overlay-in .35s ease-out }
        .b2b-overlay-out { animation: b2b-overlay-out .22s ease-in forwards }

        /* Focus rings desenhados — o outline default some sobre o foil */
        .b2b-focus-ink:focus-visible { outline: 2px solid hsl(28 62% 13%); outline-offset: 2px }
        .b2b-focus-gold:focus-visible { outline: 2px solid hsl(48 95% 72%); outline-offset: 2px }

        /* ─── Intro: barra de chocolate ─── */
        @keyframes b2b-bar-in {
          0%   { opacity: 0; transform: translateY(-55vh) rotate(6deg) }
          62%  { opacity: 1; transform: translateY(14px) rotate(-9.5deg) }
          80%  { transform: translateY(-6px) rotate(-7.5deg) }
          100% { opacity: 1; transform: translateY(0) rotate(-8deg) }
        }
        .b2b-bar-in { animation: b2b-bar-in .85s cubic-bezier(.25,1.1,.4,1) both }
        /* Escala no wrapper (não no elemento animado — o fill do keyframe pinaria o transform) */
        @media (max-width: 639px) { .b2b-bar-scale { transform: scale(.78) } }

        @keyframes b2b-mini-peek {
          0%   { transform: translateX(0) }
          20%  { transform: translateX(-2.5%) }
          100% { transform: translateX(64%) }
        }
        @keyframes b2b-mini-bob {
          0%, 100% { transform: translateX(64%) }
          50%      { transform: translateX(68%) }
        }
        .b2b-mini-peek {
          animation:
            b2b-mini-peek .95s cubic-bezier(.3,.9,.3,1) .1s both,
            b2b-mini-bob 1.7s ease-in-out 1.15s infinite;
        }
        @keyframes b2b-mini-pull {
          0%   { transform: translateX(66%); opacity: 1 }
          100% { transform: translateX(150%) rotate(3deg); opacity: 0 }
        }
        .b2b-mini-pull { animation: b2b-mini-pull .5s cubic-bezier(.5,0,.7,.4) both }

        @keyframes b2b-bar-exit {
          0%   { opacity: 1; transform: translateY(0) rotate(-8deg) }
          100% { opacity: 0; transform: translateY(55vh) rotate(-24deg) }
        }
        .b2b-bar-exit { animation: b2b-bar-exit .5s ease-in both }

        /* ─── Bilhete final ─── */
        @keyframes b2b-ticket-in {
          0%   { opacity: 0; transform: scale(.42) rotate(-7deg) }
          62%  { opacity: 1; transform: scale(1.03) rotate(1.2deg) }
          100% { opacity: 1; transform: scale(1) rotate(0) }
        }
        .b2b-ticket-in { animation: b2b-ticket-in .6s cubic-bezier(.22,1.2,.36,1) both }
        .b2b-ticket-out { animation: b2b-overlay-out .22s ease-in forwards }

        @keyframes b2b-shine {
          0%, 55% { transform: translateX(-130%) skewX(-18deg) }
          85%, 100% { transform: translateX(230%) skewX(-18deg) }
        }
        .b2b-shine { animation: b2b-shine 3.4s ease-in-out 0.7s infinite }

        /* Glow: pulsa 3x e assenta no valor base (celebração é evento, não estado) */
        @keyframes b2b-glow {
          0%, 100% { box-shadow: 0 0 70px -14px hsl(43 95% 55% / .5), 0 28px 80px -24px rgb(0 0 0 / .85) }
          50%      { box-shadow: 0 0 100px -10px hsl(43 95% 55% / .65), 0 28px 80px -24px rgb(0 0 0 / .85) }
        }
        .b2b-glow { animation: b2b-glow 2.8s ease-in-out 3 }

        /* Confetti: 2 quedas e para (forwards segura opacity 0 do fim) */
        @keyframes b2b-confetti {
          0%   { opacity: 0; transform: translateY(-12vh) rotate(0deg) }
          12%  { opacity: 1 }
          100% { opacity: 0; transform: translateY(88vh) rotate(540deg) translateX(calc(var(--drift) * 6vw)) }
        }
        .b2b-confetti { animation: b2b-confetti var(--dur) linear var(--delay) 2 forwards }

        /* Furos de picote só quando o canhoto existe (>= sm) */
        @media (min-width: 640px) {
          .b2b-ticket-mask {
            -webkit-mask-image: radial-gradient(circle 11px at 148px 0, transparent 98%, black 100%), radial-gradient(circle 11px at 148px 100%, transparent 98%, black 100%);
            -webkit-mask-composite: source-in;
            mask-image: radial-gradient(circle 11px at 148px 0, transparent 98%, black 100%), radial-gradient(circle 11px at 148px 100%, transparent 98%, black 100%);
            mask-composite: intersect;
          }
        }

        /* Serif editorial de gráfica antiga + script do embrulho — stacks de sistema, zero fetch */
        .b2b-serif { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif }
        .b2b-script { font-family: "Brush Script MT", "Segoe Script", "Lucida Handwriting", Georgia, serif }

        @media (prefers-reduced-motion: reduce) {
          .b2b-ticket-in, .b2b-shine, .b2b-glow, .b2b-confetti,
          .b2b-bar-in, .b2b-mini-peek, .b2b-mini-pull, .b2b-bar-exit,
          .b2b-overlay-in, .b2b-overlay-out { animation: none !important }
          .b2b-confetti { display: none }
        }
      `}</style>

      {/* Confetti dourado — só no payoff do bilhete */}
      {phase === "ticket" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className="b2b-confetti absolute top-0 rounded-[2px]"
              style={
                {
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.size * 1.6,
                  background: `hsl(${c.hue} 100% ${52 + (i % 3) * 8}%)`,
                  opacity: 0,
                  "--dur": `${c.duration}s`,
                  "--delay": `${c.delay}s`,
                  "--drift": c.drift,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* Intro — barra de chocolate */}
      {phase !== "ticket" && <WonkaBar phase={phase} onPull={pull} />}

      {/* Bilhete */}
      {phase === "ticket" && (
      <div
        className={`relative w-full max-w-[880px] ${leaving ? "b2b-ticket-out" : "b2b-ticket-in"}`}
        style={{ perspective: "1200px" }}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={onTiltMove}
        onMouseLeave={onTiltLeave}
      >
        {/* Glow em wrapper próprio — a mask do bilhete cortaria o box-shadow */}
        <div
          className="b2b-glow absolute inset-0 rounded-xl"
          style={{
            boxShadow:
              "0 0 70px -14px hsl(43 95% 55% / .5), 0 28px 80px -24px rgb(0 0 0 / .85)",
          }}
          aria-hidden
        />
        <div
          ref={tiltRef}
          className="b2b-ticket-mask relative overflow-hidden rounded-xl"
          style={{
            background: GOLD_FOIL,
            transition: "transform 160ms ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          {/* Reflexo pontual seguindo o cursor — foil reagindo à luz */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(260px circle at var(--mx, 50%) var(--my, 40%), hsl(52 100% 92% / .22), transparent 70%)",
            }}
            aria-hidden
          />
          {/* Textura de foil — bandas diagonais quase invisíveis */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "repeating-linear-gradient(112deg, hsl(50 100% 96% / .08) 0 2px, transparent 2px 7px)",
            }}
            aria-hidden
          />

          {/* Luz varrendo o foil */}
          <div
            className="b2b-shine pointer-events-none absolute inset-y-0 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, hsl(52 100% 92% / 0.35), transparent)",
            }}
            aria-hidden
          />

          {/* Moldura gravada dupla + ornamentos de canto */}
          <div
            className="pointer-events-none absolute inset-[7px] rounded-lg"
            style={{ border: `1px solid ${INK_SOFT}` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-[11px] rounded-md"
            style={{ border: `1px solid hsl(28 45% 24% / .45)` }}
            aria-hidden
          />
          {[
            "left-[7px] top-[7px]",
            "right-[7px] top-[7px]",
            "left-[7px] bottom-[7px]",
            "right-[7px] bottom-[7px]",
          ].map((pos) => (
            <span
              key={pos}
              className={`pointer-events-none absolute ${pos} h-2 w-2 rotate-45`}
              style={{ background: INK_SOFT, margin: "-4.5px" }}
              aria-hidden
            />
          ))}

          <button
            onClick={close}
            aria-label="Fechar"
            className="b2b-focus-ink absolute right-3 top-3 z-10 rounded-full p-2.5 transition-colors hover:bg-black/10"
            style={{ color: INK_SOFT }}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex">
            {/* Canhoto — foto oficial dos palestrantes impressa no foil (duotone dourado) */}
            <div
              className="relative hidden w-[148px] shrink-0 flex-col items-center justify-between overflow-hidden py-8 sm:flex"
              style={{ borderRight: `2px dashed ${INK_SOFT}` }}
            >
              <img
                src={EVENT_ART_URL}
                alt="Palestrantes do B2B Summit 2026"
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  // Zoom na faixa dos rostos do trio principal da arte
                  objectPosition: "50% 30%",
                  transform: "scale(1.9)",
                  transformOrigin: "50% 33%",
                  filter: "saturate(0.85) contrast(1.05)",
                }}
              />
              {/* Duotone dourado — funde a foto no material do bilhete */}
              <div
                className="absolute inset-0"
                style={{ background: "hsl(43 85% 52% / .3)", mixBlendMode: "color" }}
                aria-hidden
              />
              {/* Véus chocolate topo/base — leitura de "Admite 1" e "Série" */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, hsl(28 55% 10% / .8) 0%, hsl(35 60% 28% / .18) 32%, hsl(35 60% 28% / .18) 62%, hsl(28 55% 10% / .82) 100%)",
                }}
                aria-hidden
              />
              <div
                className="b2b-serif relative text-[11px] font-bold uppercase tracking-[0.3em]"
                style={{ color: "hsl(50 100% 90%)", textShadow: "0 1px 3px rgb(0 0 0 / .6)" }}
              >
                Admite 1
              </div>
              <div className="relative flex-1" />
              <div className="relative text-center">
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.25em]"
                  style={{ color: "hsl(48 90% 80% / .9)", textShadow: "0 1px 3px rgb(0 0 0 / .6)" }}
                >
                  Série
                </div>
                <div
                  className="font-mono text-xs font-bold"
                  style={{ color: "hsl(50 100% 90%)", textShadow: "0 1px 3px rgb(0 0 0 / .6)" }}
                >
                  TQ-2026-B2B
                </div>
              </div>
            </div>

            {/* Corpo */}
            <div className="relative flex-1 px-6 py-6 sm:px-8">
              {/* Código de barras — detalhe de autenticidade do bilhete */}
              <div
                className="pointer-events-none absolute right-3.5 top-1/2 hidden h-24 w-2 -translate-y-1/2 sm:block"
                style={{
                  opacity: 0.45,
                  background:
                    "repeating-linear-gradient(180deg, hsl(28 62% 13%) 0 2px, transparent 2px 4px, hsl(28 62% 13%) 4px 5px, transparent 5px 9px, hsl(28 62% 13%) 9px 12px, transparent 12px 14px)",
                }}
                aria-hidden
              />
              <div
                className="b2b-serif px-8 text-center text-[10px] font-bold uppercase tracking-[0.28em] sm:px-0 sm:text-[11px] sm:tracking-[0.34em]"
                style={{ color: INK_SOFT }}
              >
                ✦ Bilhete Dourado · 2ª Edição 2026 ✦
              </div>

              <h2
                className="b2b-serif mt-1 text-center text-4xl font-black uppercase leading-none tracking-tight sm:text-[2.75rem]"
                style={{ color: INK, textShadow: "0 1px 0 hsl(52 100% 88% / .55)" }}
              >
                B2B Summit
              </h2>

              <p
                className="b2b-serif mt-1.5 text-center text-[13px] italic leading-snug"
                style={{ color: INK_SOFT }}
              >
                Saudações, feliz portador: <strong>R$ 50 OFF</strong> no ingresso Comum pra
                acelerar uma década da sua fábrica, indústria ou distribuidora — em um dia.
              </p>

              <div
                className="mt-3 flex items-center justify-center gap-2 text-[13px] font-semibold"
                style={{ color: INK }}
              >
                {EVENT_DATE_LABEL && (
                  <>
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{EVENT_DATE_LABEL}</span>
                    <span aria-hidden style={{ opacity: 0.5 }}>
                      ·
                    </span>
                  </>
                )}
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                AENFLO · São José — SC
              </div>

              <div
                className="mt-1 text-center text-[11px] font-medium"
                style={{ color: "hsl(28 50% 20% / .85)" }}
              >
                Com Rodrigo Prado, Leonardo Meireles, Luan Tavares e mais 4 palestrantes
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-1.5">
                <PriceRow
                  icon={<Ticket className="h-4 w-4" aria-hidden />}
                  label="Ingresso Comum"
                  badge="R$ 50 OFF"
                  original="R$ 147"
                  final="R$ 97"
                  highlight
                />
                <PriceRow
                  icon={<Crown className="h-4 w-4" aria-hidden />}
                  label="Ingresso VIP"
                  final="R$ 247"
                />
              </div>

              {/* Placa do cupom — confirmação, não tarefa: o CTA já leva com o cupom aplicado */}
              <button
                onClick={copyCoupon}
                className="b2b-focus-ink mt-3 flex w-full items-center justify-between rounded-md px-3.5 py-2.5 transition-transform hover:scale-[1.01] active:scale-[0.99]"
                style={{
                  border: `2px dashed ${INK_SOFT}`,
                  background: "hsl(50 100% 94% / .3)",
                }}
                aria-label={`Copiar cupom ${coupon}`}
              >
                <span
                  className="text-[11px] font-bold uppercase tracking-[0.22em]"
                  style={{ color: INK_SOFT }}
                >
                  Cupom aplicado
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="font-mono text-lg font-black tracking-[0.18em]"
                    style={{ color: INK }}
                  >
                    {coupon}
                  </span>
                  {copied ? (
                    <Check className="h-4 w-4" style={{ color: "hsl(140 60% 22%)" }} aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" style={{ color: INK_SOFT }} aria-hidden />
                  )}
                </span>
              </button>
              <div
                className="mt-1 text-center text-[11px] font-medium uppercase tracking-[0.14em]"
                style={{ color: INK_SOFT }}
                aria-live="polite"
              >
                {copied
                  ? "Cupom copiado"
                  : "Aplicado automaticamente no checkout — copie se precisar"}
              </div>

              <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <button
                  ref={ctaRef}
                  onClick={buy}
                  className="b2b-focus-gold inline-flex flex-1 items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-bold transition-[transform,filter] hover:scale-[1.02] hover:brightness-110 active:scale-[0.99]"
                  style={{
                    background: INK,
                    color: "hsl(48 95% 72%)",
                    boxShadow: "0 8px 22px -8px hsl(28 62% 13% / .7)",
                  }}
                >
                  <Ticket className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">Comprar com R$ 50 OFF</span>
                </button>
                <button
                  onClick={close}
                  className="b2b-focus-ink px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-70"
                  style={{ color: INK_SOFT }}
                >
                  Agora não
                </button>
              </div>

              <div
                className="mt-2.5 text-center text-[10px] font-medium uppercase tracking-[0.2em]"
                style={{ color: "hsl(28 50% 20% / .75)" }}
              >
                Realização — Milennials Group · Aethos Sistemas
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>,
    document.body
  );
}
