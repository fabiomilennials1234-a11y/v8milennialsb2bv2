/**
 * Registry dos cards SOB MEDIDA do Estúdio — DADO, não componente.
 *
 * ── Por que existe ──
 *
 * Os painéis de Comando mostram coisas que o motor de métricas não produz:
 * funil trapezoidal, pódio de ranking, jornada do lead, campeões de produto.
 * Nenhuma combinação de `metricId` + `chart` reproduz esses visuais. Sem este
 * registry, trazer aqueles painéis para o Estúdio custaria perder as telas.
 *
 * ── Por que os componentes moram noutro arquivo ──
 *
 * Este módulo é `.ts` de propósito. Os adaptadores vivem em
 * `components/metrics-studio/fixed-card-adapters.tsx`, e a separação não é
 * organização: um módulo que exporta componentes E não-componentes quebra o
 * Fast Refresh, e o `react-refresh/only-export-components` reprova. Registry é
 * mapa de metadados; adaptador é React.
 *
 * ── Cada entrada aponta para um ADAPTADOR ──
 *
 * Os componentes de Comando têm props heterogêneos: `RankingPodium` e
 * `ProductChampions` se viram com um intervalo, mas `TrapezoidFunnel` e
 * `LeadJourney` recebem dados já calculados pela aba pai. Apontar para o
 * componente cru obrigaria o canvas a montar quatro conjuntos de props. O
 * adaptador inverte isso — o canvas entrega sempre o mesmo contexto.
 *
 * Consequência prática, e é o que dita a ordem do trabalho: card cujo dado vem
 * de fora precisa GANHAR um adaptador que busque esse dado. Não é só registrar.
 *
 * ── Contrato de estabilidade ──
 *
 * A chave é gravada no `layout` jsonb do painel, no banco. Renomear uma chave é
 * migração de dado, não refactor: painéis existentes apontariam para um card
 * que não existe mais. Se precisar renomear, mantenha o id antigo como alias —
 * o custo de um alias é uma linha; o de um painel quebrado, uma reclamação que
 * ninguém consegue reproduzir.
 */

import type {
  FixedCardContext,
  FixedCardEntry,
} from "@/modules/analytics/lib/metrics-studio-fixed-card-contract";
import {
  CampeoesProdutoCard,
  RankingVendedoresCard,
} from "@/modules/analytics/components/metrics-studio/fixed-card-adapters";

export type { FixedCardContext, FixedCardEntry };

export const FIXED_CARDS: Record<string, FixedCardEntry> = {
  "ranking-vendedores": {
    label: "Pódio de vendedores",
    descricao: "Ranking do time no período",
    tamanhoPadrao: { w: 480, h: 360 },
    render: RankingVendedoresCard,
  },
  "campeoes-produto": {
    label: "Campeões de produto",
    descricao: "Produtos que mais venderam no período",
    tamanhoPadrao: { w: 480, h: 320 },
    render: CampeoesProdutoCard,
  },
};

export type FixedCardId = keyof typeof FIXED_CARDS;

/**
 * Resolve a chave gravada no painel.
 *
 * Devolve `undefined` para chave desconhecida em vez de estourar — painel
 * gravado por uma versão mais nova, ou card removido do registry, não pode
 * derrubar a tela inteira. O canvas trata `undefined` não desenhando aquela
 * janela, exatamente como já faz com métrica que sumiu do catálogo.
 */
export function resolveFixedCard(id: string | undefined): FixedCardEntry | undefined {
  if (!id) return undefined;
  return FIXED_CARDS[id];
}
