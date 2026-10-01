import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Uma rajada de confete em canvas, a partir de um ponto.
 *
 * Sem dependência: ~100 linhas cobrem o que o produto usa — uma explosão para
 * cima, gravidade, arrasto do ar e o "tremular" do papel (a largura oscila com
 * o giro, que é o que faz confete parecer confete e não pontinho).
 *
 * O canvas ocupa o contêiner (`absolute inset-0`) e não captura clique. A
 * rajada dispara quando `origin` chega; trocar a `key` dispara outra.
 */

export interface ConfettiBurstProps {
  /** Ponto de saída, em px relativos ao contêiner. */
  origin: { x: number; y: number };
  /** Cores das peças. */
  colors: readonly string[];
  count?: number;
  /** Abertura do cone para cima, em graus (0 = reto para cima). */
  spread?: number;
  /** Velocidade inicial, em px/quadro a 60 fps. */
  power?: number;
  className?: string;
  onDone?: () => void;
}

interface Peca {
  x: number;
  y: number;
  vx: number;
  vy: number;
  giro: number;
  vGiro: number;
  tremor: number;
  vTremor: number;
  w: number;
  h: number;
  cor: string;
  redonda: boolean;
}

const GRAVIDADE = 0.32;
const ARRASTO = 0.985;
const VIDA_MS = 2200;

export function ConfettiBurst({
  origin,
  colors,
  count = 140,
  spread = 70,
  power = 13,
  className,
  onDone,
}: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      onDoneRef.current?.();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    ctx.scale(dpr, dpr);

    const abertura = (spread * Math.PI) / 180;
    const pecas: Peca[] = Array.from({ length: count }, () => {
      const angulo = -Math.PI / 2 + (Math.random() - 0.5) * 2 * abertura;
      const v = power * (0.45 + Math.random() * 0.75);
      return {
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angulo) * v,
        vy: Math.sin(angulo) * v,
        giro: Math.random() * Math.PI * 2,
        vGiro: (Math.random() - 0.5) * 0.35,
        tremor: Math.random() * Math.PI * 2,
        vTremor: 0.08 + Math.random() * 0.12,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        cor: colors[Math.floor(Math.random() * colors.length)],
        redonda: Math.random() < 0.22,
      };
    });

    const inicio = performance.now();
    let ultimo = inicio;
    let frame = 0;
    const passo = (agora: number) => {
      // Normaliza para 60 fps: o confete cai igual num monitor de 144 Hz.
      const k = Math.min((agora - ultimo) / 16.67, 3);
      ultimo = agora;
      const decorrido = agora - inicio;
      const alfa = decorrido > VIDA_MS * 0.65 ? Math.max(0, 1 - (decorrido - VIDA_MS * 0.65) / (VIDA_MS * 0.35)) : 1;

      ctx.clearRect(0, 0, largura, altura);
      ctx.globalAlpha = alfa;
      for (const p of pecas) {
        p.vx *= Math.pow(ARRASTO, k);
        p.vy = p.vy * Math.pow(ARRASTO, k) + GRAVIDADE * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.giro += p.vGiro * k;
        p.tremor += p.vTremor * k;
        if (p.y > altura + 20) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.fillStyle = p.cor;
        if (p.redonda) {
          ctx.beginPath();
          ctx.arc(0, 0, p.h * 0.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // A largura oscila com o tremor: o papel "vira" no ar.
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w * Math.cos(p.tremor), p.h);
        }
        ctx.restore();
      }

      if (decorrido < VIDA_MS) {
        frame = requestAnimationFrame(passo);
      } else {
        ctx.clearRect(0, 0, largura, altura);
        onDoneRef.current?.();
      }
    };
    frame = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(frame);
    // A rajada é UMA: parâmetros novos pedem uma `key` nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}
