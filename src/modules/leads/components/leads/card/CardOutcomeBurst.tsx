import { memo, useEffect, useRef, useState } from "react";
import { ShaderAnimation } from "@/components/ui/shader-animation";
import { concluirEfeito, opacidadeDaOnda, useEfeitoDeDesfecho, type EfeitoAtivo } from "../../../lib/card-effects";

/**
 * A onda de anéis que atravessa o card quando o negócio é ganho (verde) ou
 * perdido (vermelho). Fica DENTRO do card, por cima do conteúdo, sem capturar
 * clique.
 *
 * É o único assinante do store no card: montado como filho próprio, só ele
 * re-renderiza quando um efeito chega. O `LeadCard` e o resto do board não.
 *
 * `mix-blend-mode: screen`: os anéis SOMAM luz ao card em vez de cobri-lo. O
 * texto continua legível durante a onda, e o fundo escuro do card vira o palco.
 */

// Os tokens do tema em RGB 0–1: --success 142 70% 45% · --destructive 0 84% 60%.
const TINTA = {
  won: [0.135, 0.765, 0.37] as const,
  lost: [0.936, 0.264, 0.264] as const,
};
const BRILHO = {
  won: "hsl(var(--success) / 0.55)",
  lost: "hsl(var(--destructive) / 0.55)",
};
const DURACAO_MS = 1800;

export const CardOutcomeBurst = memo(function CardOutcomeBurst({ entryId }: { entryId: string }) {
  const efeito = useEfeitoDeDesfecho(entryId);
  if (!efeito) return null;
  return <Onda key={efeito.id} entryId={entryId} efeito={efeito} />;
});

function Onda({ entryId, efeito }: { entryId: string; efeito: EfeitoAtivo }) {
  const camada = useRef<HTMLDivElement>(null);
  // Sem WebGL: o mesmo tempo e a mesma cor, num brilho radial em CSS.
  const [semWebgl, setSemWebgl] = useState(false);
  const tipo = efeito.efeito;

  // A opacidade sai do relógio do EFEITO, não do da montagem: se o card
  // remontar em outra coluna no meio, a onda segue de onde estava.
  useEffect(() => {
    let frame = 0;
    const passo = () => {
      const p = (performance.now() - efeito.inicio) / DURACAO_MS;
      if (camada.current) camada.current.style.opacity = String(opacidadeDaOnda(p));
      if (p >= 1) {
        concluirEfeito(entryId, efeito.id);
        return;
      }
      frame = requestAnimationFrame(passo);
    };
    frame = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(frame);
  }, [entryId, efeito]);

  return (
    <div
      ref={camada}
      aria-hidden
      data-testid={`card-efeito-${tipo}`}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]"
      style={{
        opacity: 0,
        mixBlendMode: "screen",
        boxShadow: `inset 0 0 0 1px ${BRILHO[tipo]}, 0 0 24px -4px ${BRILHO[tipo]}`,
      }}
    >
      {semWebgl ? (
        <div
          className="h-full w-full"
          style={{ background: `radial-gradient(circle at 50% 50%, ${BRILHO[tipo]} 0%, transparent 70%)` }}
        />
      ) : (
        <ShaderAnimation tint={TINTA[tipo]} speed={1.6} intensity={0.85} onUnsupported={() => setSemWebgl(true)} />
      )}
    </div>
  );
}
