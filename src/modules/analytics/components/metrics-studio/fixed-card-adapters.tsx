/**
 * Adaptadores dos cards SOB MEDIDA — a ponte entre o contexto que o Estúdio
 * entrega e os props que cada componente de Comando espera.
 *
 * ── Por que os adaptadores moram longe do registry ──
 *
 * O registry (`lib/metrics-studio-fixed-cards.ts`) é DADO: um mapa de chave para
 * metadados. Este arquivo é COMPONENTE. Misturar os dois num arquivo só quebra o
 * Fast Refresh — `react-refresh/only-export-components` reprova, e com razão:
 * o HMR não consegue distinguir o que remontar quando o módulo exporta as duas
 * naturezas.
 *
 * ── Por que existe um adaptador, e não o componente cru ──
 *
 * Os componentes de Comando têm props heterogêneos. `RankingPodium` e
 * `ProductChampions` se viram com um intervalo — buscam os próprios dados.
 * `TrapezoidFunnel` e `LeadJourney` recebem dados JÁ CALCULADOS pela aba pai,
 * e por isso ainda não estão aqui: cada um vai precisar de um adaptador que
 * busque o que a aba pai buscava. Isso é trabalho real, não registro.
 *
 * O adaptador inverte a dependência: o canvas entrega sempre o mesmo contexto e
 * cada card resolve o que precisa. Sem isso, o canvas teria que saber montar
 * quatro conjuntos de props diferentes.
 */

import { lazy, Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { FixedCardContext } from "@/modules/analytics/lib/metrics-studio-fixed-card-contract";

/**
 * `lazy` porque estes componentes carregam bibliotecas de gráfico pesadas e um
 * painel raramente usa todos. Sem isto, abrir o Estúdio pagaria o custo de todo
 * card sob medida existente, usado ou não.
 */
const RankingPodium = lazy(() =>
  import("@/modules/analytics/components/dashboard/v2/RankingPodium").then((m) => ({
    default: m.RankingPodium,
  })),
);

const ProductChampions = lazy(() =>
  import("@/modules/analytics/components/dashboard/v2/ProductChampions").then((m) => ({
    default: m.ProductChampions,
  })),
);

function Carregando() {
  return <Skeleton className="h-full w-full rounded-lg" />;
}

export function RankingVendedoresCard({ range }: FixedCardContext) {
  return (
    <Suspense fallback={<Carregando />}>
      <RankingPodium range={range} />
    </Suspense>
  );
}

export function CampeoesProdutoCard({ range }: FixedCardContext) {
  return (
    <Suspense fallback={<Carregando />}>
      <ProductChampions range={range} />
    </Suspense>
  );
}
