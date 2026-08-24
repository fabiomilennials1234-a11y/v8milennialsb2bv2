import { usePipelineDisplayConfig } from "../hooks/config/usePipelineDisplayConfig";
import {
  usePermanentCustomFunnels,
  useTemporaryFunnels,
} from "../hooks/custom/useCustomPipelines";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";

/**
 * Fonte única de navegação entre funis.
 *
 * Antes existia só dentro do `FunisHub` (mapas locais de ícone/rota/cor). O
 * seletor de funil da faixa de controles precisa da mesma lista, e duplicar os
 * mapas garantiria divergência na primeira vez que alguém renomeasse um funil.
 */

export const FUNNEL_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

export const FUNNEL_COLOR_MAP: Record<string, string> = {
  whatsapp: "#3b82f6",
  confirmacao: "#8b5cf6",
  propostas: "#f97316",
  upsell: "#ec4899",
};

export type FunnelGroup = "estrutural" | "custom" | "prazo";

export interface FunnelOption {
  /** Estável por funil: `sys:<pipe_type>` ou `custom:<id>`. */
  key: string;
  label: string;
  color: string;
  path: string;
  group: FunnelGroup;
  /** Funil com prazo já encerrado — listado por último e esmaecido. */
  ended?: boolean;
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

  const options: FunnelOption[] = [];

  for (const config of displayConfigs) {
    if (!config.is_visible) continue;
    if (config.pipe_type === "upsell") continue;
    if (config.pipe_type === "confirmacao" && hasFeature("merged_opportunity_funnel")) continue;
    const path = FUNNEL_PATH_MAP[config.pipe_type];
    if (!path) continue;
    options.push({
      key: `sys:${config.pipe_type}`,
      label: config.display_name,
      color: FUNNEL_COLOR_MAP[config.pipe_type] ?? "#64748b",
      path,
      group: "estrutural",
    });
  }

  const pushCustom = (rows: CustomFunnelRow[], group: FunnelGroup) => {
    for (const row of rows) {
      if (!row.slug) continue; // sem slug não há rota — não oferecer link morto
      options.push({
        key: `custom:${row.id}`,
        label: row.name,
        color: row.color ?? "#64748b",
        path: `/pipe/custom/${row.slug}`,
        group,
        ended: row.status === "ended",
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
