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
import { useFeaturePermissions, useIdentity, useOrganization, useUserRole } from "@/modules/identity";
import { useMetaPages } from "@/modules/communication/hooks/chat-meta/useMetaPages";
import { useMetricsStudioEnabled } from "@/modules/analytics";
import {
  useActiveTemporaryFunnels,
  usePermanentCustomFunnels,
  usePipelineDisplayConfig,
} from "@/modules/pipelines";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/modules/platform/lib/feature-registry";
import {
  FUNIL_ICON,
  FUNIS_PATHS,
  PIPE_PATH_MAP,
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
        const key = SIDEBAR_FEATURE_MAP[path];
        if (!key) return false;
        return !hasFeature(key);
      },
    [isMaster, hasFeature],
  );

  const featureKeyFor = (path: string) => SIDEBAR_FEATURE_MAP[path];

  /**
   * Filhos de Funis — uma lista só.
   *
   * Não há mais classe de funil na lateral: mesmo ícone, sem cor própria, sem
   * linha separando bloco de bloco. O que existia — pipes da org primeiro,
   * depois customizados permanentes, depois os com prazo, cada bloco abrindo
   * com um `startsGroup` — desenhava três categorias que o produto não tem
   * mais. A gaveta do celular (`SidebarMobileDrawer`) já ignorava o
   * `startsGroup` e sempre mostrou a lista lisa; agora o desktop concorda.
   *
   * A ORDEM de concatenação fica: é a que o usuário já conhece (os da org por
   * `position`, depois os criados por ele). Ordem não é rótulo de categoria.
   */
  const funisChildren = useMemo<NavNode[]>(() => {
    const pipes: NavNode[] = (displayConfig ?? [])
      .filter((c) => c.is_visible)
      // Carteira é porta própria na lateral — não se repete dentro de Funis.
      .filter((c) => c.pipe_type !== "upsell")
      // Agendamentos some quando o merge de oportunidades está ligado (ADR-0004).
      .filter((c) => !(c.pipe_type === "confirmacao" && hasFeature("merged_opportunity_funnel")))
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        label: c.display_name,
        icon: FUNIL_ICON,
        path: PIPE_PATH_MAP[c.pipe_type] ?? "/funis",
      }));

    // Membro de org outbound continua vendo só os pipes: este `return` é o
    // único ponto onde a distinção carrega semântica de ACESSO, não de estilo.
    if (isOutboundMember) return pipes;

    const permanentes: NavNode[] = permanentPipelines.map((pipe) => ({
      label: pipe.name,
      icon: FUNIL_ICON,
      path: `/pipe/custom/${pipe.slug}`,
    }));

    const temporarios: NavNode[] = temporaryFunnels.map((pipe) => ({
      label: pipe.name,
      icon: FUNIL_ICON,
      path: `/pipe/custom/${pipe.slug}`,
    }));

    return [...pipes, ...permanentes, ...temporarios];
  }, [displayConfig, hasFeature, isOutboundMember, permanentPipelines, temporaryFunnels]);

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
