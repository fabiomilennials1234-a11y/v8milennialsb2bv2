/**
 * resolveBlastMessage — per-recipient message resolution (Module A).
 *
 * - Variable substitution: `{key}` → data[key]; unknown/null/undefined → "" so
 *   a placeholder never leaks to a lead. Values are coerced to string.
 * - Spintax `{a|b|c}` is NOT a variable (it contains `|`) and passes through
 *   here untouched — it is resolved in Slice 3, extending this same interface.
 *
 * `rng` is injectable for deterministic spintax in tests (unused until Slice 3).
 */

// A variable token is {word}: letters/digits/underscore only. The `|` in
// spintax excludes it from this pattern.
const VARIABLE_TOKEN = /\{(\w+)\}/g;
// A spintax group is {a|b|c}: braces containing at least one `|` and no nested
// braces. Disjoint from variable tokens (which never contain `|`).
const SPINTAX_GROUP = /\{([^{}]*\|[^{}]*)\}/g;

/**
 * Pick one option per spintax group using the injected rng. Resolved AFTER
 * variables: substituting variables first turns "{oi {nome}|e aí}" into
 * "{oi Pedro|e aí}", which then matches the (no-nested-braces) spintax pattern.
 */
function expandSpintax(text: string, rng: () => number): string {
  return text.replace(SPINTAX_GROUP, (_match, body: string) => {
    const options = body.split("|");
    const idx = Math.min(options.length - 1, Math.max(0, Math.floor(rng() * options.length)));
    return options[idx];
  });
}

function substituteVariables(text: string, data: Record<string, string | number | null | undefined>): string {
  return text.replace(VARIABLE_TOKEN, (_match, key: string) => {
    const value = data[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

export function resolveBlastMessage(
  template: string,
  data: Record<string, string | number | null | undefined> = {},
  rng: () => number = Math.random,
): string {
  return expandSpintax(substituteVariables(template, data), rng);
}
