/**
 * Scope vocabulary for the public REST API (ADR-0008, decision 7).
 *
 * `resource:action` pragmatic scopes. Stored in `api_keys.scopes` (TEXT[]).
 * Backward compat: legacy keys carrying `lead:write` remain a superset of
 * ingest+update, so `lead:write` also satisfies `lead:ingest`.
 */

export const API_SCOPES = [
  "lead:read",
  "lead:write", // PATCH + stage + tags + custom-fields
  "lead:ingest", // legacy create-via-webhook
  "pipeline:read",
  "metadata:read", // tags + custom-fields catalogs
  "webhook:read",
  // ADR-0030: Negócio é recurso próprio, com escopo próprio. `lead:write`
  // deliberadamente NÃO concede `deal:write` — permissão de editar a pessoa não
  // é permissão de abrir venda no funil dela.
  "deal:read",
  "deal:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Scopes implied by a granted scope (transitive grants, backward compat). */
const SCOPE_SUPERSETS: Record<string, string[]> = {
  "lead:write": ["lead:ingest"],
};

/** Returns true when `granted` satisfies the `required` scope. */
export function hasScope(granted: string[], required: string): boolean {
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;
  for (const g of granted) {
    if (SCOPE_SUPERSETS[g]?.includes(required)) return true;
  }
  return false;
}
