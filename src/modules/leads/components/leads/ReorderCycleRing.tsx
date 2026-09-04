import { cn } from "@/lib/utils";
import type { CicloDeRecompra } from "../../lib/reorder-cycle";

/**
 * Anel do tempo médio de recompra.
 *
 * O anel é a barra de progresso: ele avança conforme os dias passam rumo à
 * próxima compra esperada, e fecha o círculo quando ela vence. Escolhido em vez
 * de uma barra reta porque a coluna guarda um número curto ("45D") — o texto
 * mora no miolo em vez de disputar espaço ao lado, e a lista não engorda.
 *
 * Três estados, três desenhos:
 *   · sem compra   — anel TRACEJADO cinza: não é progresso zerado, é ausência
 *                    de trilho. Contínuo em cinza leria como "0% do caminho".
 *   · uma compra   — anel contínuo apagado, sem arco: existe cliente, ainda não
 *                    existe intervalo a medir.
 *   · com ciclo    — trilha + arco. Verde quando está na época de recomprar.
 */

/** Diâmetro do anel. 52px é o mínimo em que "informações" cabe no miolo. */
const TAMANHO = 52;
const ESPESSURA = 3.5;
const RAIO = (TAMANHO - ESPESSURA) / 2;
const PERIMETRO = 2 * Math.PI * RAIO;

/**
 * Tamanho da fonte pelo comprimento da maior palavra.
 *
 * O rótulo varia de 3 a 11 caracteres ("45D" → "informações") e o miolo tem
 * ~45px. Uma fonte fixa ou estoura em "informações" ou desperdiça o número, que
 * é o dado que o vendedor lê de relance.
 */
function corpoDaFonte(palavras: string[]): number {
  const maior = Math.max(...palavras.map((p) => p.length));
  if (maior <= 3) return 13;
  if (maior <= 6) return 10;
  return 8.5;
}

function descricao(ciclo: CicloDeRecompra): string {
  if (ciclo.estado === "sem-compra") return "Sem compra registrada";
  if (ciclo.estado === "uma-compra") {
    return "Uma compra registrada — ainda não há intervalo para calcular a média";
  }
  const media = `Recompra a cada ${ciclo.mediaDias} dias`;
  const desde = `última há ${ciclo.diasDesdeUltima} ${ciclo.diasDesdeUltima === 1 ? "dia" : "dias"}`;
  if (ciclo.diasRestantes == null) return media;
  if (ciclo.diasRestantes < 0) {
    return `${media} · ${desde} · atrasado em ${Math.abs(ciclo.diasRestantes)} ${
      Math.abs(ciclo.diasRestantes) === 1 ? "dia" : "dias"
    }`;
  }
  return `${media} · ${desde} · faltam ${ciclo.diasRestantes} ${
    ciclo.diasRestantes === 1 ? "dia" : "dias"
  }`;
}

export function ReorderCycleRing({ ciclo }: { ciclo: CicloDeRecompra }) {
  const palavras = ciclo.rotulo.split(" ");
  const fonte = corpoDaFonte(palavras);
  const semCompra = ciclo.estado === "sem-compra";
  const comCiclo = ciclo.estado === "com-ciclo";
  const texto = descricao(ciclo);

  return (
    <span
      className="inline-flex items-center"
      role="img"
      aria-label={texto}
      title={texto}
    >
      <span className="relative inline-flex shrink-0" style={{ width: TAMANHO, height: TAMANHO }}>
        <svg width={TAMANHO} height={TAMANHO} viewBox={`0 0 ${TAMANHO} ${TAMANHO}`} aria-hidden="true">
          {/* trilha */}
          <circle
            cx={TAMANHO / 2}
            cy={TAMANHO / 2}
            r={RAIO}
            fill="none"
            strokeWidth={ESPESSURA}
            strokeDasharray={semCompra ? "3 4" : undefined}
            className={cn(
              "stroke-border",
              ciclo.emEpoca && "stroke-success/25",
            )}
          />
          {/* arco de progresso — só existe quando há ciclo a percorrer */}
          {comCiclo && (
            <circle
              cx={TAMANHO / 2}
              cy={TAMANHO / 2}
              r={RAIO}
              fill="none"
              strokeWidth={ESPESSURA}
              strokeLinecap="round"
              strokeDasharray={PERIMETRO}
              strokeDashoffset={PERIMETRO * (1 - ciclo.progresso)}
              transform={`rotate(-90 ${TAMANHO / 2} ${TAMANHO / 2})`}
              className={cn(
                "transition-[stroke-dashoffset] duration-500",
                ciclo.emEpoca ? "stroke-success" : "stroke-primary",
              )}
            />
          )}
        </svg>

        <span
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center px-1 text-center font-semibold leading-[1.05] tracking-[-0.01em]",
            semCompra || ciclo.estado === "uma-compra"
              ? "text-muted-foreground"
              : ciclo.emEpoca
                ? "text-success"
                : "text-foreground",
          )}
          style={{ fontSize: fonte }}
        >
          {palavras.map((p) => (
            <span key={p} className={cn(comCiclo && "tabular-nums")}>
              {p}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
