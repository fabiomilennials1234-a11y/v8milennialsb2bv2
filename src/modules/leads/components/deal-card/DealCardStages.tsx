import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealCardStage } from "./types";

/**
 * A trilha do funil — onde o negócio está e o que falta.
 *
 * No card do Lead a barra é anônima (só casas), porque lá cabe um trilho de
 * 348px e o nome da etapa já vai ao lado. Aqui há largura, então cada casa
 * ganha o nome: a pergunta do card do negócio é "para onde ele vai agora", e
 * isso exige ver a próxima etapa pelo nome.
 *
 * Etapa terminal fica FORA da trilha. Ganhar e perder não são "a última casa
 * do caminho" — são saídas. Misturá-las na régua sugere que perder é o fim
 * natural de quem não avançou, o que é exatamente a leitura errada.
 */
export function DealCardStages({
  etapas,
  atual,
  cor,
}: {
  etapas: DealCardStage[];
  atual: string;
  cor: string;
}) {
  const trilha = etapas.filter((e) => e.papel === "aberto");
  const terminal = etapas.find((e) => e.chave === atual && e.papel !== "aberto");
  const indiceAtual = trilha.findIndex((e) => e.chave === atual);

  if (terminal) {
    const ganho = terminal.papel === "ganho";
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2.5",
          ganho
            ? "border-success/40 bg-success/10"
            : "border-destructive/35 bg-destructive/[0.07]",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            ganho ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive",
          )}
          aria-hidden="true"
        >
          {ganho ? <Check className="size-3" /> : <X className="size-3" />}
        </span>
        <span className={cn("text-[13px] font-semibold", ganho ? "text-success" : "text-destructive")}>
          {terminal.nome}
        </span>
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          saiu do fluxo
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-stretch gap-1">
      {trilha.map((e, i) => {
        const passou = indiceAtual >= 0 && i < indiceAtual;
        const aqui = i === indiceAtual;
        return (
          <div key={e.chave} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-[5px] rounded-full transition-colors",
                aqui || passou ? "" : "bg-muted",
              )}
              style={aqui || passou ? { background: cor } : undefined}
            />
            <span
              className={cn(
                "truncate text-[11px] leading-tight",
                aqui ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
              title={e.nome}
            >
              {e.nome}
            </span>
          </div>
        );
      })}
    </div>
  );
}
