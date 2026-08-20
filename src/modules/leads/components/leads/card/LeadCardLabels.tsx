import { memo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Etiquetas do lead, como pílulas COM NOME.
 *
 * Era um risco colorido de 1,5px por etiqueta, com o nome só no tooltip — e o
 * componente já recebia o nome, apenas o descartava. Etiqueta que só se lê
 * passando o mouse não é etiqueta, é enfeite: quem varre um board de 30 cards
 * não passa o mouse em nada.
 *
 * A cor da etiqueta vem do banco (livre, escolhida pelo usuário), então ela é
 * aplicada como TINTA translúcida sobre a superfície do card, não como fundo
 * sólido. Assim uma etiqueta clara não vira ilha branca no tema escuro — que é
 * exatamente o defeito que o mapa de origens tinha.
 */
interface Tag {
  name: string;
  color: string;
}

interface LeadCardLabelsProps {
  tags?: Tag[] | null;
  className?: string;
}

const MAX_VISIBLE = 3;

export const LeadCardLabels = memo(function LeadCardLabels({ tags, className }: LeadCardLabelsProps) {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, MAX_VISIBLE);
  const extra = tags.length - visible.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        {visible.map((tag, i) => {
          const cor = tag.color || "#888888";
          return (
            <span
              key={`${tag.name}-${i}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-px text-[10px] font-semibold leading-[18px]"
              style={{
                // 12% de tinta assenta em qualquer tema; a borda a 24% dá o
                // contorno sem precisar de cor sólida.
                backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,
                borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
                color: cor,
              }}
            >
              <i
                className="h-[5px] w-[5px] shrink-0 rounded-full"
                style={{ backgroundColor: cor }}
                aria-hidden
              />
              <span className="truncate">{tag.name}</span>
            </span>
          );
        })}
        {extra > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="rounded bg-muted/40 px-1 py-px text-[9px] font-semibold text-muted-foreground/70">
                +{extra}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              {tags.slice(MAX_VISIBLE).map((t) => t.name).join(" · ")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
});
