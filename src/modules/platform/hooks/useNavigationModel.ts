/**
 * Monta a navegação lateral já filtrada para o usuário atual.
 *
 * Junta quatro fontes que a top bar consultava soltas: config de exibição dos
 * pipes, funis customizados, matriz de permissão e gating de plano. O
 * componente que consome isto não decide mais nada — só desenha.
 *
 * Diferença relevante em relação a `TopNavigation`: lá os filhos de Funis eram
 * escritos por cima da constante de módulo (`funisItem.children = ...`), o que
 * vazava entre renders e entre instâncias. Aqui a lista é derivada, nunca mutada.
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";

import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { funisDeSistemaNavegaveis } from "@/contracts/pipe/nome-do-funil";
import { useFeaturePermissions, useIdentity, useOrganization, useUserRole } from "@/modules/identity";
import { useMetaPages } from "@/modules/communication/hooks/chat-meta/useMetaPages";
import { useMetricsStudioEnabled } from "@/modules/analytics";
import {
  funilIcon,
  useActiveTemporaryFunnels,
  usePermanentCustomFunnels,
  usePipelineDisplayConfig,
  usePipelines,
} from "@/modules/pipelines";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/modules/platform/lib/feature-registry";
import {
  FUNIS_PATHS,
  PITSTOP_GROUPS,
  buildSettingsGroup,
  SIDEBAR_AGENDA,
  SIDEBAR_PITSTOP,
  SIDEBAR_PRIMARY,
  TURBO_CHILDREN,
  TURBO_PATHS,
  type NavNode,
  type PitstopGroup,
} from "@/modules/platform/lib/navigation-model";
import { SETTINGS_BASE_PATH } from "@/modules/platform/lib/settings-tabs";
import {
  filterByGate,
  filterByMaster,
  filterByOutbound,
  filterByPermission,
  isRouteActive,
  makeCanViewRoute,
  pruneChildren,
} from "@/modules/platform/lib/navigation-filters";

export interface NavigationModel {
  /** As portas da lateral, já filtradas e com os filhos de Funis resolvidos. */
  primary: NavNode[];
  /** Grupos do Pitstop; grupos que ficaram vazios não voltam. */
  pitstopGroups: PitstopGroup[];
  /** Agenda e Pitstop vivem no rodapé — `null` quando a permissão nega. */
  agenda: NavNode | null;
  pitstop: NavNode | null;
  isOutboundMember: boolean;
  /** Rota bloqueada por plano (não por permissão) — abre o modal de upgrade. */
  isLocked: (path: string) => boolean;
  featureKeyFor: (path: string) => FeatureKey | undefined;
  canViewRoute: (path: string) => boolean;
  isActive: (path: string) => boolean;
  /** Verdadeiro quando a rota atual está dentro de algum grupo do Pitstop. */
  isPitstopRoute: boolean;
}

export function useNavigationModel(): NavigationModel {
  const location = useLocation();
  const { isAdmin, isMaster } = useIdentity();
  const { data: userRole } = useUserRole();
  const { data: featurePerms } = useFeaturePermissions();
  const { hasFeature } = useOrgFeatures();
  const { orgType } = useOrganization();
  const { data: displayConfig } = usePipelineDisplayConfig();
  const { data: permanentPipelines = [] } = usePermanentCustomFunnels();
  const { data: temporaryFunnels = [] } = useActiveTemporaryFunnels();
  // Registro único dos funis — a lateral reflete cor/ícone que o usuário
  // escolheu (SCRUM-637), em vez do ícone fixo pra todo mundo.
  const { data: pipelineRows = [] } = usePipelines();
  const { data: metaPages } = useMetaPages();
  const metricsStudio = useMetricsStudioEnabled();

  const isOutboundMember = orgType === "outbound" && userRole?.role === "member";
  const metaPagesConnected = (metaPages?.pages.length ?? 0) > 0;
  const metricsStudioEnabled = metricsStudio.enabled;

  const canViewRoute = useMemo(
    () => makeCanViewRoute({ isMaster, isAdmin, featurePerms }),
    [isMaster, isAdmin, featurePerms],
  );

  /** Plano é uma camada à parte da permissão: admin também é barrado, master não. */
  const isLocked = useMemo(
    () =>
      (path: string): boolean => {
        if (isMaster) return false;
        if (path === "/turbo") {
          // Turbo só tranca quando NENHUM filho está liberado.
          return TURBO_CHILDREN.every((child) => {
            const key = SIDEBAR_FEATURE_MAP[child.path];
            return key ? !hasFeature(key) : false;
          });
        }
        const key =
          SIDEBAR_FEATURE_MAP[path] ??
          (path.startsWith("/funil/") ? SIDEBAR_FEATURE_MAP["/funil"] : undefined);
        if (!key) return false;
        return !hasFeature(key);
      },
    [isMaster, hasFeature],
  );

  // Rota única de funil (SCRUM-637): itens /funil/<slug> herdam a chave do
  // prefixo — o mapa não enumera slugs.
  const featureKeyFor = (path: string) =>
    SIDEBAR_FEATURE_MAP[path] ??
    (path.startsWith("/funil/") ? SIDEBAR_FEATURE_MAP["/funil"] : undefined);

  /**
   * Filhos de Funis — uma lista só.
   *
   * Não há classe de funil na lateral — mas há IDENTIDADE: cada funil aparece
   * com a cor e o ícone que o usuário escolheu (`pipelines.icon/color`,
   * SCRUM-637). O que morreu foi o ícone fixo por espécie; o que fica é o
   * mesmo tratamento pra todo funil, de fábrica ou criado pelo usuário. Nome
   * de funil de sistema continua vindo do display_config (rename prevalece).
   *
   * A ORDEM de concatenação fica: é a que o usuário já conhece (os da org por
   * `position`, depois os criados por ele). Ordem não é rótulo de categoria.
   */
  const funisChildren = useMemo<NavNode[]>(() => {
    const rowBySlug = new Map(pipelineRows.map((p) => [p.slug, p] as const));
    const rowById = new Map(pipelineRows.map((p) => [p.id, p] as const));

    // Visibilidade + Carteira fora + merge de oportunidades: regra ÚNICA em
    // contracts (`funisDeSistemaNavegaveis`), compartilhada com o hub `/funis`
    // e o seletor da faixa. Ela também ordena — e sobre CÓPIA: o `.sort()` que
    // vivia aqui reordenava o próprio array do cache do react-query.
    const pipes: NavNode[] = funisDeSistemaNavegaveis(displayConfig, {
      mergeDeOportunidadesAtivo: hasFeature("merged_opportunity_funnel"),
    })
      .map((c) => {
        const row = rowBySlug.get(c.pipe_type);
        return {
          label: c.display_name,
          icon: funilIcon(row?.icon),
          color: row?.color,
          // SCRUM-637 (flip): funil de sistema navega pela rota única, igual
          // aos custom — o PIPE_PATH_MAP morreu junto com as páginas /pipe-*.
          path: `/funil/${c.pipe_type}`,
        };
      });

    // Membro de org outbound continua vendo só os pipes: este `return` é o
    // único ponto onde a distinção carrega semântica de ACESSO, não de estilo.
    if (isOutboundMember) return pipes;

    const permanentes: NavNode[] = permanentPipelines.map((pipe) => ({
      label: pipe.name,
      icon: funilIcon(rowById.get(pipe.id)?.icon),
      color: rowById.get(pipe.id)?.color ?? undefined,
      path: `/funil/${pipe.slug}`,
    }));

    const temporarios: NavNode[] = temporaryFunnels.map((pipe) => ({
      label: pipe.name,
      icon: funilIcon(rowById.get(pipe.id)?.icon),
      color: rowById.get(pipe.id)?.color ?? undefined,
      path: `/funil/${pipe.slug}`,
    }));

    return [...pipes, ...permanentes, ...temporarios];
  }, [displayConfig, hasFeature, isOutboundMember, permanentPipelines, temporaryFunnels, pipelineRows]);

  const primary = useMemo(() => {
    // Cópia: a constante do módulo nunca é escrita.
    const withChildren = SIDEBAR_PRIMARY.map((item) =>
      item.path === "/funis" ? { ...item, children: funisChildren } : { ...item },
    );
    const filtered = filterByPermission(
      filterByGate(
        filterByMaster(filterByOutbound(withChildren, isOutboundMember), isMaster),
        { metaPagesConnected, metricsStudioEnabled },
      ),
      canViewRoute,
    );
    return pruneChildren(filtered, canViewRoute);
  }, [
    funisChildren,
    isOutboundMember,
    isMaster,
    metaPagesConnected,
    metricsStudioEnabled,
    canViewRoute,
  ]);

  const pitstopGroups = useMemo(() => {
    // Membro de org outbound não tem Pitstop: o recorte dele não inclui
    // nenhuma dessas rotas, e um painel vazio é pior que painel nenhum.
    if (isOutboundMember) return [];
    // O grupo de Configurações fecha o painel: é por ele que `/configuracoes`
    // passa a ter caminho de UI no desktop, onde o gatilho do Pitstop só abre.
    const groups = [
      ...PITSTOP_GROUPS,
      buildSettingsGroup({ isAdmin, isOutboundOrg: orgType === "outbound" }),
    ];
    return groups
      .map((group) => ({
        ...group,
        // O Pitstop passa pelo mesmo gate da lateral: Métricas vive aqui e
        // continua escondida enquanto a org não estiver no rollout.
        items: filterByGate(group.items, { metaPagesConnected, metricsStudioEnabled }).filter(
          (item) => canViewRoute(item.path),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [canViewRoute, isAdmin, isOutboundMember, metaPagesConnected, metricsStudioEnabled, orgType]);

  const isActive = useMemo(
    () =>
      (path: string): boolean => {
        // Aba de configuração casa exata: por prefixo, um slug novo que comece
        // igual a outro (`/configuracoes/api` × `/configuracoes/api-keys`)
        // acenderia dois itens ao mesmo tempo.
        if (path.startsWith(`${SETTINGS_BASE_PATH}/`)) return location.pathname === path;
        const extras =
          path === "/funis" ? FUNIS_PATHS : path === "/turbo" ? TURBO_PATHS : [];
        return isRouteActive(location.pathname, path, extras);
      },
    [location.pathname],
  );

  const isPitstopRoute = useMemo(
    () =>
      location.pathname.startsWith("/configuracoes") ||
      pitstopGroups.some((group) =>
        group.items.some((item) => isRouteActive(location.pathname, item.path)),
      ),
    [location.pathname, pitstopGroups],
  );

  return {
    primary,
    pitstopGroups,
    agenda: canViewRoute(SIDEBAR_AGENDA.path) && !isOutboundMember ? SIDEBAR_AGENDA : null,
    pitstop: canViewRoute(SIDEBAR_PITSTOP.path) && !isOutboundMember ? SIDEBAR_PITSTOP : null,
    isOutboundMember,
    isLocked,
    featureKeyFor,
    canViewRoute,
    isActive,
    isPitstopRoute,
  };
}
