import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Coreografia de sucesso do 2FA — porte do protótipo aprovado pelo CTO
 * (`CLAUDE/perfumarias/perfumaria-torque-2fa.html`).
 *
 * Sequência: as 6 caixas do código saem da fileira, voam para um círculo,
 * orbitam duas voltas, ficam verdes, convergem no centro com um estouro de
 * partículas — e entra a tela "Verificado com sucesso" (anéis pulsando,
 * partículas cintilando, botão Continuar).
 *
 * Imperativo por natureza: a órbita é trigonometria por frame, e framer-motion
 * não descreve "seis elementos girando em formação" sem virar um motor de
 * animação dentro de props. rAF + refs é o código do protótipo, provado.
 *
 * `prefers-reduced-motion`: pula direto pra tela de sucesso — a coreografia é
 * recompensa, não informação; ninguém perde nada além do brilho.
 */

const BOX_W = 44;
const BOX_H = 50;
const EXPANDED_H = 240;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function tween(dur: number, fn: (p: number) => void, alive: () => boolean): Promise<void> {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (t: number) => {
      if (!alive()) return res();
      const p = Math.min(1, (t - t0) / dur);
      fn(p);
      if (p < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}

interface MfaVerifyEffectProps {
  /** Os 6 dígitos aceitos — aparecem nas caixas durante o voo. */
  code: string;
  onContinue: () => void;
}

export function MfaVerifyEffect({ code, onContinue }: MfaVerifyEffectProps) {
  const otpRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const digits = (code || "").padEnd(6, "•").slice(0, 6).split("");

  useEffect(() => {
    const otp = otpRef.current;
    const boxes = boxRefs.current.filter(Boolean) as HTMLDivElement[];
    if (!otp || boxes.length !== 6) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShowSuccess(true);
      return;
    }

    let mounted = true;
    const alive = () => mounted;

    const burst = (cx: number, cy: number) => {
      for (let i = 0; i < 12; i++) {
        const d = document.createElement("div");
        d.className = "pointer-events-none absolute size-[5px] rounded-full bg-success";
        d.style.left = `${cx}px`;
        d.style.top = `${cy}px`;
        otp.appendChild(d);
        const ang = Math.random() * Math.PI * 2;
        const dist = 34 + Math.random() * 46;
        d.animate(
          [
            { transform: "translate(-50%,-50%)", opacity: 1 },
            {
              transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(.4)`,
              opacity: 0,
            },
          ],
          { duration: 550 + Math.random() * 350, easing: "cubic-bezier(.2,.6,.3,1)" },
        ).onfinish = () => d.remove();
      }
    };

    (async () => {
      // posições atuais na fileira → absoluto, pra poderem voar
      const starts = boxes.map((b) => ({ x: b.offsetLeft, y: b.offsetTop }));
      boxes.forEach((b, i) => {
        b.style.position = "absolute";
        b.style.left = `${starts[i].x}px`;
        b.style.top = `${starts[i].y}px`;
        b.style.margin = "0";
        b.style.zIndex = "3";
      });
      otp.style.height = `${EXPANDED_H}px`;
      await sleep(80);
      if (!alive()) return;

      const cx = otp.clientWidth / 2;
      const cy = 120;
      const R = 80;
      const angle = (i: number) => ((-90 + i * 60) * Math.PI) / 180;

      // 1) da fileira para o círculo
      await tween(650, (p) => {
        const e = easeInOut(p);
        boxes.forEach((b, i) => {
          const tx = cx + R * Math.cos(angle(i)) - BOX_W / 2;
          const ty = cy + R * Math.sin(angle(i)) - BOX_H / 2;
          b.style.left = `${starts[i].x + (tx - starts[i].x) * e}px`;
          b.style.top = `${starts[i].y + (ty - starts[i].y) * e}px`;
        });
      }, alive);

      // 2) órbita: 2 voltas, formação girando junto; verde a 80%
      let greened = false;
      await tween(1750, (p) => {
        const e = easeInOut(p);
        const phi = 720 * e;
        boxes.forEach((b, i) => {
          const a = angle(i) + (phi * Math.PI) / 180;
          b.style.left = `${cx + R * Math.cos(a) - BOX_W / 2}px`;
          b.style.top = `${cy + R * Math.sin(a) - BOX_H / 2}px`;
          b.style.transform = `rotate(${phi}deg)`;
        });
        if (!greened && p > 0.8) {
          greened = true;
          boxes.forEach((b) => b.classList.add("mfa-box-green"));
        }
      }, alive);
      await sleep(280);
      if (!alive()) return;

      // 3) convergência: empilha no centro, dígitos somem
      boxes.forEach((b) => b.classList.add("mfa-box-nodigit"));
      const tilts = boxes.map(() => (Math.random() - 0.5) * 22);
      await tween(480, (p) => {
        const e = easeInOut(p);
        const r = R * (1 - e);
        boxes.forEach((b, i) => {
          const a = angle(i);
          b.style.left = `${cx + r * Math.cos(a) - BOX_W / 2}px`;
          b.style.top = `${cy + r * Math.sin(a) - BOX_H / 2}px`;
          b.style.transform = `rotate(${tilts[i] * e}deg) scale(${1 - 0.08 * e})`;
        });
      }, alive);
      if (!alive()) return;
      burst(cx, cy);

      // 4) some tudo e entra o sucesso
      await tween(300, (p) => {
        boxes.forEach((b) => (b.style.opacity = String(1 - p)));
      }, alive);
      await sleep(180);
      if (alive()) setShowSuccess(true);
    })();

    return () => {
      mounted = false;
    };
    // roda uma vez por montagem — o code é congelado no aceite
  }, []);

  return (
    <div className="relative">
      {/* estilos que precisam alcançar as caixas manipuladas por ref */}
      <style>{`
        .mfa-box-green > div {
          background: hsl(var(--success)) !important;
          border-color: hsl(var(--success) / .7) !important;
          color: hsl(var(--success-foreground)) !important;
        }
        .mfa-box-nodigit > div { color: transparent !important; }
        @keyframes mfaRingPulse {
          0%, 100% { transform: translate(-50%,-50%) scale(1); }
          50% { transform: translate(-50%,-50%) scale(1.045); }
        }
        @keyframes mfaTwinkle {
          0%, 100% { opacity: .15; transform: scale(.7); }
          50% { opacity: .9; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mfa-anim { animation: none !important; }
        }
      `}</style>

      {!showSuccess && (
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground">Confirme que é você</h2>
          <p className="text-muted-foreground mt-2 mb-6 text-sm">Código aceito.</p>
          <div
            ref={otpRef}
            className="relative mx-auto flex h-[50px] items-start justify-center gap-2 overflow-visible"
            style={{ transition: "height .65s cubic-bezier(.45,0,.2,1)" }}
            aria-hidden="true"
          >
            {digits.map((d, i) => (
              <div key={i} ref={(el) => (boxRefs.current[i] = el)} className="relative h-[50px] w-[44px]">
                <div
                  className={cn(
                    "flex h-full w-full items-center justify-center rounded-[10px] border text-xl",
                    "border-input bg-muted/40 text-foreground",
                    "transition-[background-color,border-color,color] duration-[450ms]",
                  )}
                >
                  {d}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="flex flex-col items-center text-center duration-500 animate-in fade-in zoom-in-95">
          <h3 className="text-2xl font-bold text-success">Verificado com sucesso</h3>
          <p className="mt-1 text-sm text-muted-foreground">Sua identidade foi confirmada.</p>

          {/* cena: check central + anéis pulsando + partículas cintilando */}
          <div className="relative my-4 flex h-[200px] w-[240px] items-center justify-center" aria-hidden="true">
            {[104, 150, 196].map((size, i) => (
              <span
                key={size}
                className="mfa-anim absolute left-1/2 top-1/2 rounded-[26px] border"
                style={{
                  width: size,
                  height: size,
                  borderColor: `hsl(var(--success) / ${0.14 - i * 0.04})`,
                  transform: "translate(-50%,-50%)",
                  animation: `mfaRingPulse 3s ease-in-out ${i * 0.4}s infinite`,
                }}
              />
            ))}
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className="mfa-anim absolute rounded-full bg-success"
                style={{
                  width: 3 + ((i * 7) % 4),
                  height: 3 + ((i * 7) % 4),
                  left: `${8 + ((i * 37) % 84)}%`,
                  top: `${5 + ((i * 53) % 90)}%`,
                  animation: `mfaTwinkle 2.4s ease-in-out ${(i * 0.31) % 2.4}s infinite`,
                }}
              />
            ))}
            <div
              className="z-[2] flex size-16 items-center justify-center rounded-[18px] border-[1.5px] border-success/70 bg-success/15"
              style={{ boxShadow: "0 0 26px hsl(var(--success) / .3)" }}
            >
              <Check className="size-7 text-success" strokeWidth={2.6} />
            </div>
          </div>

          <p className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold text-success">
            <Check className="size-3.5" strokeWidth={3} />
            Verificado e seguro
          </p>

          <Button className="rounded-full px-10" onClick={onContinue}>
            Continuar
          </Button>
        </div>
      )}
    </div>
  );
}
