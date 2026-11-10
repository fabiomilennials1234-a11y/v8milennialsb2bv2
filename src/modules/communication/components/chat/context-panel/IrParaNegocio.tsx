/**
 * "Ir para o negócio" — na 2ª linha de cada negócio em "Funis do lead".
 *
 * Link compacto, no lugar da dica "Clique na etapa para mover" (a linha ganha
 * só a altura do alvo de toque, 24 px), e Ganho/Perda continua sendo o peso
 * visual do cartão (é a decisão comercial; navegar é secundário). Numa linha
 * só: o chip da etapa espreme a coluna, e o texto trunca em vez de quebrar e
 * vazar da caixa. É um LINK de verdade — o destino é uma URL
 * (`/funil/<funil>?negocio=<negócio>`) —, então Ctrl/⌘+clique abre o negócio
 * noutra aba sem perder a conversa. O board lê o endereço, rola até o card e o
 * faz brilhar.
 *
 * Mesmas portas da rota do board: permissão `pipeline.view` e o plano com
 * funis. Sem elas o funil não existe para a pessoa — o link também não.
 */
import { ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
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
}) {
  const navigate = useNavigate();
  const verFunil = useCanDo("pipeline.view");
  const planoTemFunis = useOrgFeaturesOptional()?.hasFeature("funnels") ?? true;

  if (verFunil.isLoading) return <div data-testid="ir-para-negocio-reserva" className="h-6" aria-hidden />;
  if (!verFunil.allowed || !planoTemFunis) return null;

  const destino = caminhoDoNegocio({ pipelineId, entryId });
  return (
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
      className={cn(
        "group/ir -ml-1.5 inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5",
        "text-[11px] font-semibold text-muted-foreground transition-colors",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        movendo && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-muted-foreground",
      )}
    >
      <span className="min-w-0 truncate">Ir para o negócio</span>
      <ArrowUpRight
        className="size-3 shrink-0 transition-transform duration-200 ease-out-expo group-hover/ir:-translate-y-px group-hover/ir:translate-x-px motion-reduce:transition-none"
        aria-hidden
      />
    </Link>
  );
}
