/**
 * useErpProvider — resolves the org's active ERP provider + its capability
 * manifest from the two connection statuses (S6, ADR-0020). No new query: it
 * composes the cached useOmieStatus + useTinyErpStatus. Surfaces gate on
 * `can(capability)`; a provider that lacks a feature simply hides it.
 */

import { useMemo } from "react";
import { useOmieStatus } from "./useOmie";
import { useTothStatus } from "./useToth";
import { useTinyErpStatus } from "@/modules/carteira";
import { resolveErpProvider, type ResolvedErp } from "../lib/erp-provider";

export interface UseErpProviderResult extends ResolvedErp {
  isLoading: boolean;
}

export function useErpProvider(): UseErpProviderResult {
  const tinyQuery = useTinyErpStatus();
  const omieQuery = useOmieStatus();
  const tothQuery = useTothStatus();

  const resolved = useMemo(
    () => resolveErpProvider(tinyQuery.data, omieQuery.data, tothQuery.data),
    [tinyQuery.data, omieQuery.data, tothQuery.data],
  );

  return {
    ...resolved,
    isLoading: tinyQuery.isLoading || omieQuery.isLoading || tothQuery.isLoading,
  };
}
