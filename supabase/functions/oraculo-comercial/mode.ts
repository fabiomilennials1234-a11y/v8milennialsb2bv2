export type OraculoCommercialMode = "tv_analysis";

export function oraculoCommercialMode(body: unknown): OraculoCommercialMode | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return (body as { mode?: unknown }).mode === "tv_analysis" ? "tv_analysis" : null;
}
