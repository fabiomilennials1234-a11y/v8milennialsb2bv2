import { ArrowRight, Bot, Cog, Flag, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealCardMove } from "./types";

/**
 * A movimentação DESTE negócio — de qual etapa para qual, quando e por quem.
 *
 * Substitui a aba "Atividade" do card atual, que hoje renderiza
 * `LeadActivityColumn`: a linha do tempo do **Lead**, não a do negócio.
 * Herança do modelo velho, em que os dois eram a mesma coisa. As 49.739 linhas
 * de `pipeline_stage_events` não aparecem em tela nenhuma hoje.
 *
 * Desenhada para UM item, que é o caso de 91% dos negócios (média 1,16
 * movimentação, e 39.297 têm só a da criação). Por isso não há cabeçalho de
 * seção pesado nem agrupamento por data: com um evento, isso seria moldura
 * maior que o quadro.
 */

const ORIGEM = {
  manual: { icone: User, rotulo: "manual" },
  automacao: { icone: Bot, rotulo: "automação" },
  sistema: { icone: Cog, rotulo: "sistema" },
} as const;

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DealCardTimeline({ movimentacoes }: { movimentacoes: DealCardMove[] }) {
  if (movimentacoes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-6 text-center text-[12.5px] text-muted-foreground">
        Sem movimentação registrada.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {movimentacoes.map((m, i) => {
        const { icone: Icone, rotulo } = ORIGEM[m.origem];
        const ultimo = i === movimentacoes.length - 1;
        const nascimento = m.de === null;
        return (
          <li key={m.id} className="relative flex gap-3 pb-3 last:pb-0">
            {!ultimo && (
              <span
                className="absolute left-[13px] top-[30px] bottom-0 w-[2px] rounded-full bg-border"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-1",
                nascimento
                  ? "bg-sky-500/15 text-sky-400 ring-sky-500/25"
                  : "bg-muted text-muted-foreground ring-border",
              )}
              aria-hidden="true"
            >
              {nascimento ? <Flag className="size-3.5" /> : <Icone className="size-3.5" />}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
                {nascimento ? (
                  <>
                    <span className="text-muted-foreground">Negócio criado em</span>
                    <span className="font-semibold">{m.para}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">{m.de}</span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                    <span className="font-semibold">{m.para}</span>
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground/75">
                {m.autor ?? rotulo} · {quando(m.quando)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
