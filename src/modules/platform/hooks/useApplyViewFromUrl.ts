import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSavedViews } from "./useSavedViews";
import { useOrganization } from "@/modules/identity";
import { resolveFilters, type SavedViewEntityType } from "@/types/saved-views";

export function useApplyViewFromUrl<T extends Record<string, unknown>>(
  entityType: SavedViewEntityType,
  defaultFilters: T,
  onApplyFilters: (filters: T) => void,
  onActiveViewChange: (viewId: string | null) => void
) {
  const [searchParams] = useSearchParams();
  const { teamMemberId } = useOrganization();
  const { data: views } = useSavedViews(entityType);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current || !views) return;
    const viewId = searchParams.get("view");
    if (!viewId) return;

    const view = views.find((v) => v.id === viewId);
    if (!view) return;

    appliedRef.current = true;
    const resolved = resolveFilters(
      view.filters as T,
      teamMemberId ?? null
    );
    onApplyFilters({ ...defaultFilters, ...resolved });
    onActiveViewChange(viewId);
  }, [views, searchParams, teamMemberId, defaultFilters, onApplyFilters, onActiveViewChange]);
}
