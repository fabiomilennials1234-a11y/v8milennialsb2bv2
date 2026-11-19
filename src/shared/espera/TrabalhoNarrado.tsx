import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FaseNarrada {
  id: string;
  rotulo: string;
}

export interface ProgressoNarrado {
  faseAtual: string;
  feitos: number;
  total: number;
  /** O que está sendo feito agora, em voz de vendedor ("Lendo site: Padaria X"). */
  itemAtual?: string;
  /** Restante estimado (ms). `null`/ausente = ainda sem ritmo para estimar. */
  estimativaMs?: number | null;
}

export interface TrabalhoNarradoProps {
  titulo: string;
  fases: readonly FaseNarrada[];
  progresso: ProgressoNarrado;
  estado: "rodando" | "parando" | "parado" | "concluido" | "falhou";
  /** Sem `onParar`, sem botão: só some quando o trabalho é de fato interrompível. */
  onParar?: () => void;
  onSegundoPlano?: () => void;
  erro?: string;
}

function formatarRestante(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s <= 60) return `~${Math.max(1, s)} s`;
  return `~${Math.ceil(s / 60)} min`;
}

const numero = new Intl.NumberFormat("pt-BR");

type EstadoDaFase = "feita" | "atual" | "pendente";

/**
 * Trabalho longo (> 10 s, estimativa conhecida antes de começar) contado em
 * voz alta: fases em barras, "X de Y" grande e tabular, o item de agora, o
 * restante, e sempre uma saída — Parar e, quando houver para onde ir,
 * "Continuar em segundo plano".
 *
 * Sem moldura própria: quem usa decide se mora num cartão, num diálogo ou
 * numa gaveta.
 */
export function TrabalhoNarrado({
  titulo,
  fases,
  progresso,
  estado,
  onParar,
  onSegundoPlano,
  erro,
}: TrabalhoNarradoProps) {
  const { faseAtual, feitos, total, itemAtual, estimativaMs } = progresso;
  const ativo = estado === "rodando" || estado === "parando";
  const indiceAtual = fases.findIndex((f) => f.id === faseAtual);

  const estadoDa = (i: number): EstadoDaFase => {
    if (estado === "concluido") return "feita";
    if (i < indiceAtual) return "feita";
    if (i === indiceAtual) return "atual";
    return "pendente";
  };

  const rotuloDaFase = fases[indiceAtual]?.rotulo;
  const restante = ativo && estimativaMs != null ? formatarRestante(estimativaMs) : null;

  return (
    <section aria-label={titulo} className="flex flex-col gap-4">
      <h3 className="text-base font-extrabold tracking-[-0.015em] text-foreground">{titulo}</h3>

      <ol className="flex gap-1.5" aria-label="Fases">
        {fases.map((f, i) => {
          const e = estadoDa(i);
          return (
            <li
              key={f.id}
              data-fase={e}
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1.5 text-[11.5px]",
                e === "atual" && "font-semibold text-foreground",
                e === "feita" && "text-muted-foreground",
                e === "pendente" && "text-muted-foreground/60",
              )}
            >
              <span
                aria-hidden
                className="relative h-1 overflow-hidden rounded-full border border-card-border bg-muted dark:bg-secondary"
              >
                {e === "feita" && <span className="absolute inset-0 bg-primary" />}
                {e === "atual" && (
                  <span className="absolute inset-0 bg-primary/35 after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:via-primary after:to-transparent motion-reduce:after:hidden" />
                )}
              </span>
              <span className="truncate">{f.rotulo}</span>
            </li>
          );
        })}
      </ol>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={feitos}
        aria-valuetext={`${feitos} de ${total}`}
        className="flex items-baseline gap-2.5"
      >
        <span className="text-[34px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-foreground">
          {numero.format(feitos)}
        </span>
        <span className="text-[13px] text-muted-foreground">
          de <b className="font-semibold tabular-nums text-foreground">{numero.format(total)}</b>
          {rotuloDaFase && ativo ? <> · {rotuloDaFase.toLocaleLowerCase("pt-BR")}</> : null}
          {restante ? <> · {restante}</> : null}
        </span>
      </div>

      {itemAtual && (
        <p
          aria-live="polite"
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-card-border bg-muted/60 px-3 py-2.5 text-[12.5px] text-foreground dark:bg-secondary/60"
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 shrink-0 rounded-full bg-primary",
              ativo && "animate-novo-pulso motion-reduce:animate-none",
            )}
          />
          <span className="truncate">{itemAtual}</span>
        </p>
      )}

      {estado === "falhou" && erro && (
        <p role="alert" className="text-[13px] font-medium text-destructive">
          {erro}
        </p>
      )}

      {ativo && (onParar || onSegundoPlano) && (
        <div className="flex flex-wrap gap-2">
          {onParar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onParar}
              disabled={estado === "parando"}
              className="border-destructive/40 text-destructive hover:border-destructive/60"
            >
              {estado === "parando" ? "Parando…" : "Parar"}
            </Button>
          )}
          {onSegundoPlano && (
            <Button type="button" variant="outline" size="sm" onClick={onSegundoPlano}>
              Continuar em segundo plano
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
