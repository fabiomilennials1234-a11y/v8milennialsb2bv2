import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { ConfettiBurst } from "@/components/ui/confetti-burst";

/**
 * A celebração DENTRO do painel do negócio, ao ganhar ou perder.
 *
 *   Ganho  — o ✓ sai do botão "Ganhou", faz um arco e cai num baú de dinheiro
 *            que abre a tampa, fecha, pula e solta confete.
 *   Perda  — o ✕ sai do botão "Perdeu" e cai numa lixeira que abre, fecha e
 *            balança, com um pouco de poeira.
 *
 * Uma linha do tempo só (`DURACAO_S`), expressa em frações: cada peça anima a
 * sua parte do mesmo relógio, então nada depende de um `onAnimationComplete`
 * encadeado no outro. A camada não captura clique — o painel segue usável
 * durante os 2 s.
 *
 * O baú e a lixeira são SVG próprios: ícone genérico de biblioteca não abre a
 * tampa, e é a tampa que conta a história.
 */

export interface Celebracao {
  id: number;
  tipo: "won" | "lost";
  /** Retângulo do botão clicado (viewport). `null`: sai de baixo, no centro. */
  origem: DOMRect | null;
}

const DURACAO_S = 2.3;
/** Frações da linha do tempo. */
const T = {
  entra: 0.1,
  tampaAbre: 0.16,
  voo: { inicio: 0.28 / DURACAO_S, dur: 0.72 / DURACAO_S },
  impacto: 1.0 / DURACAO_S,
  sai: 0.83,
};
const TAMANHO = { w: 140, h: 120 };
const PROJETIL = 46;

const CORES_CONFETE = [
  "hsl(142 70% 45%)", // --success
  "hsl(142 76% 66%)",
  "hsl(47 100% 50%)", // o dourado da marca
  "hsl(47 100% 70%)",
  "hsl(0 0% 100%)",
  "hsl(168 76% 42%)",
];

/** O topo do arco nunca sai do painel: o botão fica no cabeçalho, colado na borda. */
const PICO_MINIMO = PROJETIL / 2 + 16;

/** Arco de lançamento: Bézier quadrática com o ponto de controle acima dos dois. */
function arco(de: { x: number; y: number }, ate: { x: number; y: number }, altura: number, n = 18) {
  const c = { x: (de.x + ate.x) / 2, y: Math.min(de.y, ate.y) - altura };
  // O ponto mais alto de uma Bézier quadrática fica perto de t = 0,5:
  // y = (de + 2c + ate) / 4. Acima do piso (y menor), o controle desce até ele.
  if ((de.y + 2 * c.y + ate.y) / 4 < PICO_MINIMO) c.y = (4 * PICO_MINIMO - de.y - ate.y) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    xs.push(a * de.x + b * c.x + d * ate.x - PROJETIL / 2);
    ys.push(a * de.y + b * c.y + d * ate.y - PROJETIL / 2);
  }
  return { xs, ys };
}

export function DealOutcomeCelebration({
  celebracao,
  container,
  onFim,
}: {
  celebracao: Celebracao;
  container: RefObject<HTMLElement>;
  onFim: () => void;
}) {
  const [geo, setGeo] = useState<{ w: number; h: number; de: { x: number; y: number } } | null>(null);
  const [impacto, setImpacto] = useState(false);
  const ganho = celebracao.tipo === "won";

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const o = celebracao.origem;
    setGeo({
      w: r.width,
      h: r.height,
      de: o
        ? { x: o.left + o.width / 2 - r.left, y: o.top + o.height / 2 - r.top }
        : { x: r.width / 2, y: r.height - 40 },
    });
  }, [celebracao, container]);

  useEffect(() => {
    const bate = setTimeout(() => setImpacto(true), T.impacto * DURACAO_S * 1000);
    const fim = setTimeout(onFim, DURACAO_S * 1000 + 50);
    return () => {
      clearTimeout(bate);
      clearTimeout(fim);
    };
    // Um relógio por celebração.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebracao.id]);

  const centro = geo ? { x: geo.w / 2, y: geo.h * 0.42 } : null;
  const boca = centro ? { x: centro.x, y: centro.y - 16 } : null;
  const voo = useMemo(
    () => (geo && boca ? arco(geo.de, boca, Math.max(140, geo.h * 0.22)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo],
  );

  if (!geo || !centro || !boca || !voo) return null;

  const tom = ganho ? "var(--success)" : "var(--destructive)";
  const fora = { duration: DURACAO_S, ease: "easeOut" as const };

  return (
    <div aria-hidden data-testid={`celebracao-${celebracao.tipo}`} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {/* Foco: um escurecimento radial em volta do recipiente, não um overlay. */}
      <motion.div
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at ${centro.x}px ${centro.y}px, hsl(var(--background) / 0.82) 0%, hsl(var(--background) / 0.55) 28%, transparent 62%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ ...fora, times: [0, T.entra, T.sai, 1] }}
      />

      {/* ── O recipiente ─────────────────────────────────────────────────── */}
      <motion.div
        className="absolute"
        style={{ left: centro.x - TAMANHO.w / 2, top: centro.y - TAMANHO.h / 2, width: TAMANHO.w, height: TAMANHO.h }}
        initial={{ opacity: 0, scale: 0.5, y: 16 }}
        animate={{
          opacity: [0, 1, 1, 0],
          y: [16, 0, 0, 0],
          scale: [0.5, 1, 1, 1.12, 0.94, 1.03, 1, 0.9],
          rotate: ganho ? 0 : [0, 0, -9, 7, -4, 0, 0],
        }}
        transition={{
          duration: DURACAO_S,
          opacity: { duration: DURACAO_S, times: [0, T.entra, T.sai, 1] },
          y: { duration: DURACAO_S, times: [0, T.entra, T.sai, 1] },
          scale: { duration: DURACAO_S, times: [0, 0.12, T.impacto - 0.01, T.impacto + 0.03, T.impacto + 0.08, T.impacto + 0.14, T.sai, 1] },
          rotate: ganho
            ? undefined
            : { duration: DURACAO_S, times: [0, T.impacto, T.impacto + 0.05, T.impacto + 0.11, T.impacto + 0.17, T.impacto + 0.23, 1] },
        }}
      >
        {ganho ? <BauDeDinheiro /> : <Lixeira />}
      </motion.div>

      {/* ── Brilho do impacto ─────────────────────────────────────────────── */}
      {impacto && (
        <motion.div
          className="absolute rounded-full"
          style={{
            left: boca.x - 60,
            top: boca.y - 60,
            width: 120,
            height: 120,
            background: `radial-gradient(circle, hsl(${tom} / 0.55) 0%, transparent 65%)`,
          }}
          initial={{ opacity: 0.9, scale: 0.4 }}
          animate={{ opacity: 0, scale: 1.8 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        />
      )}

      {/* ── O símbolo, em arco, do botão até a boca ───────────────────────── */}
      <motion.div
        className="absolute left-0 top-0 flex items-center justify-center rounded-full text-white"
        style={{
          width: PROJETIL,
          height: PROJETIL,
          background: `hsl(${tom})`,
          boxShadow: `0 0 0 4px hsl(${tom} / 0.22), 0 8px 24px -6px hsl(${tom} / 0.8)`,
        }}
        initial={{ x: voo.xs[0], y: voo.ys[0], opacity: 0, scale: 0.6 }}
        animate={{
          x: voo.xs,
          y: voo.ys,
          opacity: [0, 1, 1, 0],
          scale: [0.6, 1.1, 0.95, 0.5],
          rotate: ganho ? [0, 540] : [0, -300],
        }}
        transition={{
          delay: T.voo.inicio * DURACAO_S,
          duration: T.voo.dur * DURACAO_S,
          ease: [0.45, 0, 0.55, 1],
          opacity: { delay: T.voo.inicio * DURACAO_S, duration: T.voo.dur * DURACAO_S, times: [0, 0.08, 0.88, 1] },
          scale: { delay: T.voo.inicio * DURACAO_S, duration: T.voo.dur * DURACAO_S, times: [0, 0.3, 0.8, 1] },
        }}
      >
        {ganho ? <Check className="size-6" strokeWidth={3} /> : <X className="size-6" strokeWidth={3} />}
      </motion.div>

      {/* ── Depois do impacto ─────────────────────────────────────────────── */}
      {impacto && ganho && (
        <ConfettiBurst origin={{ x: boca.x, y: boca.y - 10 }} colors={CORES_CONFETE} count={150} spread={62} power={14} />
      )}
      {impacto && !ganho && <Poeira em={boca} />}

      {impacto && (
        <motion.p
          className="absolute w-full text-center text-sm font-semibold tracking-tight"
          style={{ top: centro.y + TAMANHO.h / 2 + 10, color: `hsl(${tom})` }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: [0, 1, 1, 0], y: [6, 0, 0, 0] }}
          transition={{ duration: DURACAO_S * (1 - T.impacto), times: [0, 0.15, 0.7, 1] }}
        >
          {ganho ? "Negócio ganho" : "Negócio perdido"}
        </motion.p>
      )}
    </div>
  );
}

/** Tampa: gira em torno da dobradiça da esquerda, abre antes do voo e fecha no impacto. */
function tampaAnimada(angulo: number) {
  return {
    animate: { rotate: [0, 0, angulo, angulo, 0, 0] },
    transition: {
      duration: DURACAO_S,
      times: [0, T.entra - 0.02, T.tampaAbre, T.impacto - 0.03, T.impacto + 0.03, 1],
      ease: "easeInOut" as const,
    },
  };
}

function BauDeDinheiro() {
  const tampa = tampaAnimada(-34);
  return (
    <svg viewBox="0 0 140 120" width="140" height="120" className="overflow-visible drop-shadow-[0_14px_22px_rgba(0,0,0,0.45)]">
      <defs>
        <linearGradient id="bau-corpo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "hsl(142 64% 38%)" }} />
          <stop offset="1" style={{ stopColor: "hsl(142 70% 24%)" }} />
        </linearGradient>
        <linearGradient id="bau-tampa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "hsl(142 62% 50%)" }} />
          <stop offset="1" style={{ stopColor: "hsl(142 66% 36%)" }} />
        </linearGradient>
        <linearGradient id="bau-ouro" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "hsl(47 100% 62%)" }} />
          <stop offset="1" style={{ stopColor: "hsl(40 96% 44%)" }} />
        </linearGradient>
      </defs>
      <ellipse cx="70" cy="114" rx="50" ry="5" fill="black" opacity="0.28" />
      {/* Moedas lá dentro: aparecem quando a tampa abre. */}
      <circle cx="52" cy="50" r="9" fill="url(#bau-ouro)" />
      <circle cx="70" cy="46" r="10" fill="url(#bau-ouro)" />
      <circle cx="88" cy="50" r="9" fill="url(#bau-ouro)" />
      <rect x="16" y="50" width="108" height="58" rx="12" fill="url(#bau-corpo)" />
      <rect x="16" y="50" width="108" height="6" fill="white" opacity="0.08" />
      <rect x="34" y="50" width="9" height="58" fill="url(#bau-ouro)" opacity="0.9" />
      <rect x="97" y="50" width="9" height="58" fill="url(#bau-ouro)" opacity="0.9" />
      <rect x="57" y="62" width="26" height="28" rx="7" fill="url(#bau-ouro)" />
      <text x="70" y="81" textAnchor="middle" fontSize="11" fontWeight="800" fill="hsl(142 70% 20%)" fontFamily="Inter, system-ui, sans-serif">
        R$
      </text>
      <motion.g style={{ originX: "16px", originY: "54px" }} {...tampa}>
        <rect x="12" y="30" width="116" height="24" rx="12" fill="url(#bau-tampa)" />
        <rect x="12" y="30" width="116" height="6" rx="3" fill="white" opacity="0.14" />
        <rect x="34" y="30" width="9" height="24" fill="url(#bau-ouro)" />
        <rect x="97" y="30" width="9" height="24" fill="url(#bau-ouro)" />
      </motion.g>
    </svg>
  );
}

function Lixeira() {
  const tampa = tampaAnimada(-40);
  return (
    <svg viewBox="0 0 140 120" width="140" height="120" className="overflow-visible drop-shadow-[0_14px_22px_rgba(0,0,0,0.45)]">
      <defs>
        <linearGradient id="lixo-corpo" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "hsl(240 4% 30%)" }} />
          <stop offset="0.5" style={{ stopColor: "hsl(240 4% 42%)" }} />
          <stop offset="1" style={{ stopColor: "hsl(240 5% 26%)" }} />
        </linearGradient>
        <linearGradient id="lixo-tampa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "hsl(240 5% 66%)" }} />
          <stop offset="1" style={{ stopColor: "hsl(240 4% 46%)" }} />
        </linearGradient>
      </defs>
      <ellipse cx="70" cy="114" rx="42" ry="5" fill="black" opacity="0.28" />
      <path d="M30 48 L110 48 L102 106 Q101 112 95 112 L45 112 Q39 112 38 106 Z" fill="url(#lixo-corpo)" />
      <path d="M52 58 L54 102 M70 58 L70 102 M88 58 L86 102" stroke="hsl(240 5% 58%)" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
      <rect x="26" y="44" width="88" height="7" rx="3.5" fill="hsl(240 5% 52%)" />
      <motion.g style={{ originX: "26px", originY: "42px" }} {...tampa}>
        <rect x="22" y="32" width="96" height="11" rx="5.5" fill="url(#lixo-tampa)" />
        <path d="M58 32 V27 Q58 23 62 23 H78 Q82 23 82 27 V32" fill="none" stroke="hsl(240 5% 62%)" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

/** Um sopro de poeira da boca da lixeira: seis grãos que saem e somem. */
function Poeira({ em }: { em: { x: number; y: number } }) {
  const graos = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const angulo = -Math.PI / 2 + (i - 3) * 0.42;
        return { dx: Math.cos(angulo) * (34 + (i % 3) * 10), dy: Math.sin(angulo) * (26 + (i % 2) * 12), r: 5 + (i % 3) * 2 };
      }),
    [],
  );
  return (
    <>
      {graos.map((g, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-muted-foreground/50"
          style={{ left: em.x - g.r, top: em.y - g.r, width: g.r * 2, height: g.r * 2 }}
          initial={{ opacity: 0.8, x: 0, y: 0, scale: 0.6 }}
          animate={{ opacity: 0, x: g.dx, y: g.dy, scale: 1.3 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      ))}
    </>
  );
}
