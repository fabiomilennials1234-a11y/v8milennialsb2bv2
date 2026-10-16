import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Medidor de torque do prompt de sugestões (estilos em `feature-suggestion.css`).
 *
 * Escala de 270° começando em 135° (inferior esquerdo), círculo r=44: o arco
 * cheio mede 207,3 e a circunferência 276,5. `value` 0..1 move arco, ponteiro,
 * as 11 marcas e a leitura "N N·m"; `transitionMs` é o tempo da mola.
 * `done` fecha o círculo, apaga ponteiro/marcas/leitura, desenha o check e
 * solta faíscas (canvas) — exceto com `reducedMotion`.
 */

const ARC = 207.3;
const FULL = 276.5;
const GOLD = "hsl(47 100% 50%)";
const SPARK_COUNT = 34;
const SPARK_DELAY_MS = 260;

const TICKS = Array.from({ length: 11 }, (_, i) => {
  const angle = ((135 + i * 27) * Math.PI) / 180;
  return {
    x1: 50 + Math.cos(angle) * 33,
    y1: 50 + Math.sin(angle) * 33,
    x2: 50 + Math.cos(angle) * 37,
    y2: 50 + Math.sin(angle) * 37,
  };
});

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function runSparks(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return () => undefined;
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2 - 4;
  const sparks = Array.from({ length: SPARK_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.6 + Math.random() * 3.4;
    return { x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, r: 1.2 + Math.random() * 2.2 };
  });
  let frame = 0;
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const s of sparks) {
      if (s.life <= 0) continue;
      alive = true;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.06;
      s.vx *= 0.985;
      s.life -= 0.022;
      ctx.globalAlpha = Math.max(s.life, 0);
      ctx.fillStyle = "hsl(47 100% 55%)";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (alive) frame = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

export interface TorqueDialProps {
  value: number;
  transitionMs: number;
  done: boolean;
  reducedMotion: boolean;
}

export function TorqueDial({ value, transitionMs, done, reducedMotion }: TorqueDialProps) {
  const p = done ? 1 : clamp01(value);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!done || reducedMotion || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let stop: () => void = () => undefined;
    const timer = setTimeout(() => {
      stop = runSparks(canvas);
    }, SPARK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [done, reducedMotion]);

  const style = { "--fsp-gt": `${reducedMotion ? 1 : transitionMs}ms` } as CSSProperties;

  return (
    <div className="fsp-gauge" aria-hidden="true" data-testid="torque-dial" data-done={done} style={style}>
      <svg viewBox="0 0 100 100">
        <g className="fsp-g-ticks">
          {TICKS.map((tick, index) => (
            <line
              key={index}
              className="fsp-g-tick"
              data-on={p > 0 && index / (TICKS.length - 1) <= p + 0.001}
              {...tick}
            />
          ))}
        </g>
        <circle
          className="fsp-g-track"
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth={5}
          strokeDasharray={`${ARC} ${FULL}`}
          strokeLinecap="round"
          transform="rotate(135 50 50)"
        />
        <circle
          className="fsp-g-arc"
          data-testid="torque-dial-arc"
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          transform="rotate(135 50 50)"
          style={{
            strokeDasharray: done ? `${FULL} 0` : `${ARC} ${FULL}`,
            strokeDashoffset: done ? 0 : ARC * (1 - p),
          }}
        />
        <g className="fsp-g-needle" data-testid="torque-dial-needle" style={{ transform: `rotate(${-135 + 270 * p}deg)` }}>
          <line x1="50" y1="50" x2="50" y2="18" stroke={GOLD} strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle className="fsp-g-hub" cx="50" cy="50" r="6" />
        <path
          className="fsp-g-check"
          d="M34 51l11 11 21-24"
          fill="none"
          stroke={GOLD}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <canvas ref={canvasRef} className="fsp-sparks" width={224} height={224} />
      <div className="fsp-g-read">
        <b data-testid="torque-dial-read">{Math.round(p * 100)}</b> N·m
      </div>
    </div>
  );
}
