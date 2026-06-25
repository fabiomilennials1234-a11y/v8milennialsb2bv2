/**
 * Gate the tool list by the mutations flag, then by an optional caller filter.
 *
 * With mutations OFF (the default), only read-only tools are visible/registered —
 * mutating tools are hidden entirely, not just refused at call time.
 *
 * `toolFilter` is an additional, independent gate applied AFTER the mutations gate.
 * crm-mcp passes `(t) => t.readonly === true && t.customerExposed === true` so its
 * customer surface is a positive allowlist (fail-closed); torque-mcp passes no filter
 * and keeps the exact previous behavior. The two questions are deliberately separate:
 * the mutations gate asks "can it write?", the filter asks "should this caller see it?".
 */
export function visibleTools<T extends { readonly: boolean }>(
  tools: T[],
  opts: { allowMutations: boolean; toolFilter?: (t: T) => boolean },
): T[] {
  const byMutation = opts.allowMutations ? tools : tools.filter((t) => t.readonly);
  return opts.toolFilter ? byMutation.filter(opts.toolFilter) : byMutation;
}
