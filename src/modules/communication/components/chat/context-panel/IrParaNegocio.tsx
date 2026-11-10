/**
 * "Ir para o negócio" — no topo de cada negócio em "Funis do lead", ACIMA do
 * nome do funil.
 *
 * Botão de largura inteira, da família do Ganho/Perda (`Button` outline, 32 px):
 * longe do chip da etapa (que move o card) e dos botões de desfecho, para que
 * navegar e decidir nunca disputem o mesmo clique. Neutro de propósito — o
 * Ganho/Perda continua sendo a decisão comercial do cartão.
 *
 * É um LINK de verdade — o destino é uma URL (`/funil/<funil>?negocio=<negócio>`)
 * —, então Ctrl/⌘+clique abre o negócio noutra aba sem perder a conversa. O
 * board lê o endereço, rola até o card e o faz brilhar.
 *
 * Mesmas portas da rota do board: permissão `pipeline.view` e o plano com
 * funis. Sem elas o funil não existe para a pessoa — o botão também não.
 */
import { ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { caminhoDoNegocio } from "@/contracts/pipe/negocio-no-funil";
import { useCanDo } from "@/modules/identity";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";

export function IrParaNegocio({
  pipelineId,
  entryId,
  funil,
  etapa,
  movendo,
  className,
}: {
  /** `pipelines.id` do negócio. */
  pipelineId: string;
  /** `pipeline_entries.id` — o negócio da linha, não o lead. */
  entryId: string;
  /** Nome do funil e da etapa, para o nome acessível. */
  funil: string;
  etapa: string | null;
  /** A etapa desta linha está mudando agora (chip com spinner). */
  movendo: boolean;
  /** Espaço até o resto da linha (vale também para a reserva do carregamento). */
  className?: string;
}) {
  const navigate = useNavigate();
  const verFunil = useCanDo("pipeline.view");
  const planoTemFunis = useOrgFeaturesOptional()?.hasFeature("funnels") ?? true;

  if (verFunil.isLoading) {
    return <div data-testid="ir-para-negocio-reserva" className={cn("h-8", className)} aria-hidden />;
  }
  if (!verFunil.allowed || !planoTemFunis) return null;

  const destino = caminhoDoNegocio({ pipelineId, entryId });
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={cn(
        // `text-foreground` explícito: o outline não define a tinta e herdaria a do contêiner.
        "group/ir h-8 w-full gap-1.5 text-[12px] text-foreground",
        movendo && "cursor-not-allowed opacity-60 hover:translate-y-0 hover:border-input",
        className,
      )}
    >
      <Link
        to={destino}
        aria-label={`Ir para o negócio em ${funil}${etapa ? `, etapa ${etapa}` : ""}`}
        aria-disabled={movendo || undefined}
        title={movendo ? "Aguarde a etapa terminar de mudar" : undefined}
        onClick={(e) => {
          if (movendo) {
            e.preventDefault();
            return;
          }
          // Enter no link (`detail === 0`): o board leva também o FOCO até o card.
          // Clique do mouse segue o link como sempre. Com modificador (Ctrl/⌘/
          // Shift+Enter ou +clique), o navegador abre noutra aba/janela — não toca.
          const comModificador = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
          if (e.detail === 0 && !comModificador) {
            e.preventDefault();
            navigate(destino, { state: { viaTeclado: true } });
          }
        }}
      >
        <span className="min-w-0 truncate">Ir para o negócio</span>
        <ArrowUpRight
          className="transition-transform duration-200 ease-out-expo group-hover/ir:-translate-y-px group-hover/ir:translate-x-px motion-reduce:transition-none"
          aria-hidden
        />
      </Link>
    </Button>
  );
}
