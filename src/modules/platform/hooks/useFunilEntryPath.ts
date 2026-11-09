/**
 * Para onde o item "Funil" da navegação aponta.
 *
 * O último funil que o usuário abriu (memória em `@/lib/last-funnel`), se ele
 * ainda aparece na lateral; senão o funil padrão da org; senão o hub.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useAuth, useOrganization, useOrganizationSettings } from "@/modules/identity";
import {
  LAST_FUNNEL_EVENT,
  browserStorage,
  funilEntryPath,
  lastFunnelKey,
  readLastFunnel,
} from "@/lib/last-funnel";
import type { NavNode } from "@/modules/platform/lib/navigation-model";

const FUNIL_PREFIX = "/funil/";

function subscribe(onChange: () => void): () => void {
  // `storage` cobre outra aba; o evento próprio cobre esta.
  window.addEventListener("storage", onChange);
  window.addEventListener(LAST_FUNNEL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LAST_FUNNEL_EVENT, onChange);
  };
}

export interface FunilEntry {
  path: string;
  /** `true` quando `path` é o último funil do usuário (e não o padrão/hub). */
  restored: boolean;
}

export function useFunilEntryPath(primary: readonly NavNode[]): FunilEntry {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const { settings } = useOrganizationSettings();

  const key = lastFunnelKey(organizationId, user?.id);
  const getSnapshot = useCallback(() => {
    const storage = browserStorage();
    return storage ? readLastFunnel(storage, key) : null;
  }, [key]);
  const lastSlug = useSyncExternalStore(subscribe, getSnapshot, () => null);

  const availableSlugs = (primary.find((item) => item.path === "/funis")?.children ?? [])
    .map((child) => child.path)
    .filter((path) => path.startsWith(FUNIL_PREFIX))
    .map((path) => path.slice(FUNIL_PREFIX.length));

  return {
    path: funilEntryPath({
      lastSlug,
      availableSlugs,
      defaultPipelineId: settings?.default_pipeline_id ?? null,
    }),
    restored: !!lastSlug && availableSlugs.includes(lastSlug),
  };
}
