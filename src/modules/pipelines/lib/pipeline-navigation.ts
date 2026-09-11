/**
 * Navigation is presentation state, independent from pipeline operation.
 * Hidden pipelines remain resolvable by UUID for existing deals and automation.
 * Missing navigation metadata is the normal state of a newly created funnel.
 */
export interface PipelineNavigationRow {
  config?: unknown;
  display_order?: number;
}

function navigationConfig(row: PipelineNavigationRow): Record<string, unknown> {
  const config = row.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const navigation = (config as Record<string, unknown>).navigation;
  return navigation && typeof navigation === "object" && !Array.isArray(navigation)
    ? navigation as Record<string, unknown>
    : {};
}

export function isPipelineVisible(row: PipelineNavigationRow): boolean {
  return navigationConfig(row).is_visible !== false;
}

function navigationPosition(row: PipelineNavigationRow): number {
  return typeof row.display_order === "number" && Number.isFinite(row.display_order)
    ? row.display_order
    : 0;
}

/** Stable copy: never reorder the React Query cache in place. */
export function sortPipelinesForNavigation<T extends PipelineNavigationRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => navigationPosition(a) - navigationPosition(b));
}

/** Lifecycle filtering (active/ended) belongs to the consuming surface. */
export function selectVisiblePipelines<T extends PipelineNavigationRow>(rows: readonly T[]): T[] {
  return sortPipelinesForNavigation(rows.filter(isPipelineVisible));
}
