/**
 * Regras de visibilidade da navegação, isoladas de React.
 *
 * São quatro camadas independentes, na mesma ordem que a top bar aplicava:
 * outbound → master → gate de runtime → permissão de view. Manter aqui, puras,
 * é o que permite testá-las sem montar componente nem tocar em Supabase.
 */

import type { NavNode } from "./navigation-model";
import { NAV_VIEW_PERMISSIONS, OUTBOUND_MEMBER_ALLOWED_PATHS } from "./navigation-model";

const isOutboundAllowed = (path: string): boolean =>
  (OUTBOUND_MEMBER_ALLOWED_PATHS as readonly string[]).some(
    // Prefixo cobre a rota única `/funil/:slug` (SCRUM-637) sem enumerar slugs.
    (allowed) => path === allowed || path.startsWith(`${allowed}/`),
  );

/**
 * Membro de org outbound enxerga só o recorte permitido. Um pai entra se ele
 * mesmo é permitido OU se tem ao menos um filho permitido — senão Funis sumiria
 * mesmo com os pipes liberados.
 */
export function filterByOutbound(items: NavNode[], isOutboundMember: boolean): NavNode[] {
  if (!isOutboundMember) return items;
  return items.filter(
    (item) =>
      isOutboundAllowed(item.path) ||
      (item.children?.some((child) => isOutboundAllowed(child.path)) ?? false),
  );
}

export function filterByMaster(items: NavNode[], isMaster: boolean): NavNode[] {
  return items.filter((item) => !item.masterOnly || isMaster);
}

export interface RuntimeGates {
  metaPagesConnected: boolean;
  metricsStudioEnabled: boolean;
}

export function filterByGate(items: NavNode[], gates: RuntimeGates): NavNode[] {
  return items.filter((item) => {
    if (item.gate === "meta_pages_connected") return gates.metaPagesConnected;
    if (item.gate === "metrics_studio_enabled") return gates.metricsStudioEnabled;
    return true;
  });
}

/**
 * Um pai com filhos sobrevive se qualquer filho for visível, mesmo que a rota
 * do próprio pai seja negada — é o caso de Funis, cuja rota-índice pode estar
 * fechada enquanto os pipes individuais não estão.
 */
export function filterByPermission(
  items: NavNode[],
  canViewRoute: (path: string) => boolean,
): NavNode[] {
  return items.filter((item) => {
    if (item.children && item.children.length > 0) {
      const visibleChildren = item.children.filter((child) => canViewRoute(child.path));
      return visibleChildren.length > 0 || canViewRoute(item.path);
    }
    return canViewRoute(item.path);
  });
}

/** Poda os filhos negados, depois que o pai já passou pelos filtros. */
export function pruneChildren(
  items: NavNode[],
  canViewRoute: (path: string) => boolean,
): NavNode[] {
  return items.map((item) =>
    item.children && item.children.length > 0
      ? { ...item, children: item.children.filter((child) => canViewRoute(child.path)) }
      : item,
  );
}

export interface ViewPermissionInput {
  isMaster: boolean;
  isAdmin: boolean;
  featurePerms: Record<string, boolean> | undefined;
}

/**
 * Master e admin passam por cima da matriz de permissão. Para os demais, só
 * uma negação explícita (`false`) fecha a rota — chave ausente é liberada.
 */
export function makeCanViewRoute({ isMaster, isAdmin, featurePerms }: ViewPermissionInput) {
  return (path: string): boolean => {
    if (isMaster || isAdmin) return true;
    const permKey =
      NAV_VIEW_PERMISSIONS[path] ??
      // Rota única de funil (SCRUM-637): qualquer `/funil/...` herda a
      // permissão do prefixo — igual ao guard de rota do App.tsx.
      (path.startsWith("/funil/") ? NAV_VIEW_PERMISSIONS["/funil"] : undefined);
    if (!permKey) return true;
    return featurePerms?.[permKey] !== false;
  };
}

/**
 * Ativação por prefixo, com `/dashboard` casando também a raiz.
 * `extraPrefixes` cobre os pais cujos filhos vivem em rotas de outra família
 * (Funis → `/pipe-*`, Turbo → `/copilot` e `/automacoes`).
 */
export function isRouteActive(
  pathname: string,
  path: string,
  extraPrefixes: readonly string[] = [],
): boolean {
  if (path === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  if (pathname.startsWith(path)) return true;
  return extraPrefixes.some((prefix) => pathname.startsWith(prefix));
}
