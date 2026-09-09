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
import {
  MetaMensalCard, IndicadoresCard, ReceitaAcumuladaCard, FunilCard, BriefingCard, OperacaoCard,
  AtividadeEquipeCard, JornadaCard, MetasEquipeCard, MetasIndividuaisCard, PerdasCard, RealEsperadoCard, SaudeCard, MapaCard,
} from "@/modules/analytics/components/metrics-studio/dashboard-card-adapters";

export type { FixedCardContext, FixedCardEntry };

export const FIXED_CARDS: Record<string, FixedCardEntry> = {
  "ranking-vendedores": {
    requiresPerformance: true,
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
  "meta-mensal": { label: "Meta do mês", descricao: "Meta e realizado do mês corrente", tamanhoPadrao: { w: 320, h: 488 }, render: MetaMensalCard },
  "indicadores-operacao": { label: "Indicadores da operação", descricao: "Período selecionado; follow-ups atrasados agora", tamanhoPadrao: { w: 984, h: 280 }, render: IndicadoresCard },
  "receita-acumulada": { label: "Receita acumulada", descricao: "Comparação com o período anterior", tamanhoPadrao: { w: 648, h: 488 }, render: ReceitaAcumuladaCard },
  "funil-conversao": { label: "Funil de conversão", descricao: "Da entrada do lead à venda no período", tamanhoPadrao: { w: 320, h: 400 }, render: FunilCard },
  "briefing-oraculo": { label: "Oráculo", descricao: "Leitura da operação e conversa com a IA", tamanhoPadrao: { w: 320, h: 400 }, render: BriefingCard },
  "operacao-ao-vivo": { label: "Operação ao vivo", descricao: "Atividades recentes, independentemente do período", tamanhoPadrao: { w: 312, h: 400 }, render: OperacaoCard },
  "atividade-equipe": { label: "Atividade da equipe", descricao: "Atividade no período selecionado", tamanhoPadrao: { w: 640, h: 400 }, render: AtividadeEquipeCard, requiresPerformance: true },
  "jornada-lead": { label: "Jornada do lead", descricao: "Caminho dos leads no período", tamanhoPadrao: { w: 328, h: 400 }, render: JornadaCard },
  "metas-equipe": { label: "Metas da equipe", descricao: "Meta e realizado do mês corrente", tamanhoPadrao: { w: 640, h: 400 }, render: MetasEquipeCard, requiresPerformance: true },
  "metas-individuais": { label: "Metas individuais", descricao: "Metas por pessoa no mês corrente", tamanhoPadrao: { w: 328, h: 400 }, render: MetasIndividuaisCard, requiresPerformance: true },
  "motivos-perda": { label: "Ganhos e perdas", descricao: "Desfechos dos negócios no período", tamanhoPadrao: { w: 328, h: 400 }, render: PerdasCard },
  "real-esperado": { label: "Realizado versus esperado", descricao: "Evolução em relação à meta do mês corrente", tamanhoPadrao: { w: 640, h: 400 }, render: RealEsperadoCard, requiresPerformance: true },
  "saude-funil": { label: "Saúde do funil", descricao: "Coortes, gargalos e conversões no período", tamanhoPadrao: { w: 984, h: 980 }, render: SaudeCard },
  "mapa-clientes": { label: "Mapa de clientes", descricao: "Distribuição geográfica da base completa — sem filtro de período", tamanhoPadrao: { w: 984, h: 720 }, render: MapaCard },
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
