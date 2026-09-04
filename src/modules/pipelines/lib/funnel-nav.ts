import { usePipelineDisplayConfig } from "../hooks/config/usePipelineDisplayConfig";
import {
  usePermanentCustomFunnels,
  useTemporaryFunnels,
} from "../hooks/custom/useCustomPipelines";
import { usePipelines } from "../hooks/model/usePipelines";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { funisDeSistemaNavegaveis } from "@/contracts/pipe/nome-do-funil";

/**
 * Fonte única de navegação entre funis.
 *
 * Antes existia só dentro do `FunisHub` (mapas locais de ícone/rota/cor). O
 * seletor de funil da faixa de controles precisa da mesma lista, e duplicar os
 * mapas garantiria divergência na primeira vez que alguém renomeasse um funil.
 */


/**
 * Cor de fallback quando a linha de `pipelines` ainda não chegou (ou o funil
 * não tem cor gravada). As cores REAIS vêm de `pipelines.color` — funil de
 * sistema persiste cor/ícone como qualquer outro (SCRUM-637; morreu o
 * `FUNNEL_COLOR_MAP` hardcoded que ignorava a personalização).
 */
export const FUNNEL_FALLBACK_COLOR = "#64748b";

/** Os funis de sistema navegáveis (Carteira fica fora — D6). */
const SYSTEM_FUNNEL_SLUGS = new Set(["whatsapp", "confirmacao", "propostas"]);

export type FunnelGroup = "estrutural" | "custom" | "prazo";

/** O que a identidade do funil precisa da linha canônica de `pipelines`. */
export interface FunnelCanonicalRow {
  id: string;
  slug: string;
  type: "system" | "custom";
  name: string;
  icon: string;
  color: string;
}

export interface FunnelOption {
  /** Estável por funil: `sys:<pipe_type>` ou `custom:<id>`. */
  key: string;
  label: string;
  color: string;
  path: string;
  group: FunnelGroup;
  /** Funil com prazo já encerrado — listado por último e esmaecido. */
  ended?: boolean;
  /**
   * Linha canônica em `pipelines` — a mesma que a aba "Geral" edita. Vem
   * junto porque o seletor é o único lugar do quadro que sabe QUAL funil está
   * aberto e como ele se chama para o usuário; sem isso, quem quisesse
   * renomear a partir do cabeçalho teria de reassinar `usePipelines` (e uma
   * segunda inscrição de Realtime na mesma tela). Ausente enquanto o registro
   * não chegou.
   */
  pipeline?: FunnelCanonicalRow;
}

// `FUNNEL_GROUP_LABEL` foi removido junto com os cabeçalhos do seletor. O tipo
// `FunnelGroup` FICA: ele diz de qual fonte a linha veio (display config, funil
// permanente, funil com prazo) e é isso que decide o `path` e o `ended`.
// Deixou de virar rótulo na tela — o usuário escolhe funil pelo nome.

interface CustomFunnelRow {
  id: string;
  name: string;
  slug: string | null;
  color: string | null;
  status?: string | null;
}

/**
 * Lista de funis para o seletor, agrupada como o protótipo desenhou.
 *
 * Regras que vêm do produto, não de estética:
 * - `confirmacao` some quando o funil mergeado está ligado (ADR-0004) — é o
 *   mesmo filtro que o `FunisHub` aplica.
 * - **Carteira (`upsell`) fica fora.** Ela saiu da navegação principal e, pelo
 *   D6, é faceta do lead, não funil de negócio. Reintroduzi-la aqui desfaria a
 *   decisão por tabela de rota.
 */
export function useFunnelOptions(): { options: FunnelOption[]; isLoading: boolean } {
  const { hasFeature } = useOrgFeatures();
  const { data: displayConfigs = [], isLoading: configLoading } = usePipelineDisplayConfig();
  const { data: permanent = [], isLoading: permanentLoading } = usePermanentCustomFunnels();
  const { data: temporary = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  // Registro único: é daqui que saem cor (e ícone) REAIS de qualquer funil —
  // funil de sistema personalizado deixa de aparecer com a cor de fábrica.
  const { data: pipelines = [] } = usePipelines();

  const pipePorSlug = new Map(pipelines.map((p) => [p.slug, p] as const));
  const pipePorId = new Map(pipelines.map((p) => [p.id, p] as const));

  const options: FunnelOption[] = [];

  const sistemaNavegavel = funisDeSistemaNavegaveis(displayConfigs, {
    mergeDeOportunidadesAtivo: hasFeature("merged_opportunity_funnel"),
  });

  for (const config of sistemaNavegavel) {
    // SCRUM-637 (flip): todo funil navega pela rota única. Carteira já foi
    // filtrada por `funisDeSistemaNavegaveis`; pipe_type fora do trio de
    // sistema não tem funil por trás — link morto não entra (mesma guarda do
    // mapa antigo).
    if (!SYSTEM_FUNNEL_SLUGS.has(config.pipe_type)) continue;
    const path = `/funil/${config.pipe_type}`;
    const row = pipePorSlug.get(config.pipe_type);
    options.push({
      key: `sys:${config.pipe_type}`,
      label: config.display_name,
      color: row?.color ?? FUNNEL_FALLBACK_COLOR,
      path,
      group: "estrutural",
      pipeline: row,
    });
  }

  const pushCustom = (rows: CustomFunnelRow[], group: FunnelGroup) => {
    for (const row of rows) {
      if (!row.slug) continue; // sem slug não há rota — não oferecer link morto
      const canonica = pipePorId.get(row.id);
      options.push({
        key: `custom:${row.id}`,
        label: row.name,
        color: canonica?.color ?? row.color ?? FUNNEL_FALLBACK_COLOR,
        path: `/funil/${row.slug}`,
        group,
        ended: row.status === "ended",
        pipeline: canonica,
      });
    }
  };

  pushCustom(permanent as CustomFunnelRow[], "custom");
  pushCustom(temporary as CustomFunnelRow[], "prazo");

  return {
    options,
    isLoading: configLoading || permanentLoading || temporaryLoading,
  };
}
