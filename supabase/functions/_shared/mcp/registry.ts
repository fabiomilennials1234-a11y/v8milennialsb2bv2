/**
 * Gate the tool list by the mutations flag. With mutations OFF (the default),
 * only read-only tools are visible/registered — mutating tools are hidden
 * entirely, not just refused at call time.
 */
export function visibleTools<T extends { readonly: boolean }>(
  tools: T[],
  opts: { allowMutations: boolean },
): T[] {
  return opts.allowMutations ? tools : tools.filter((t) => t.readonly);
}
