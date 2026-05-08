export interface SavedView {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  entity_type: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  is_system: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SavedViewInsert {
  name: string;
  entity_type: string;
  filters: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export interface SavedViewUpdate {
  name?: string;
  filters?: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export const ME_PLACEHOLDER = "__me__";

export function resolveFilters<T extends Record<string, unknown>>(
  filters: T,
  currentUserId: string | null
): T {
  const resolved = { ...filters };
  for (const [key, value] of Object.entries(resolved)) {
    if (value === ME_PLACEHOLDER && currentUserId) {
      (resolved as Record<string, unknown>)[key] = currentUserId;
    }
  }
  return resolved;
}
