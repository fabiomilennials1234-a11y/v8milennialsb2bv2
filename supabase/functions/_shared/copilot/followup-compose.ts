/**
 * Base-text composer for Copilot Follow-up.
 *
 * Pure logic — resolves a Situation touch's base template against per-Lead
 * variables. This is the deterministic path and the fallback when LLM
 * refinement (#736) is skipped or fails. Any unresolved {placeholder} is
 * stripped so it never leaks to a Lead.
 */

export function composeBaseText(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "gi"), value ?? "");
  }
  // Strip any placeholder the caller did not provide.
  return out.replace(/\{[^}]+\}/g, "").trim();
}
