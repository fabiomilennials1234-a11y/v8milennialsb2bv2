/**
 * useLeadOrigins — fonte única (dinâmica) de origens de lead (Slice A).
 *
 * Cobre: fetch da tabela registry, labelOf/colorOf, fallback de built-ins,
 * override de slug por origem custom da org, e a garantia de que os 13
 * built-ins (incluindo os 6 que faltavam no form antigo) estão expostos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper, mockSupabaseQuery } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => mockFrom(...a) },
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));

import {
  useLeadOrigins,
  BUILTIN_LEAD_ORIGINS,
  FALLBACK_ORIGIN_COLOR,
} from "@/modules/leads/hooks/useLeadOrigins";

const PREVIOUSLY_MISSING = [
  "indicacao",
  "evento",
  "prospeccao_ativa",
  "instagram",
  "tiktok",
  "landing_page",
];

describe("useLeadOrigins", () => {
  beforeEach(() => vi.clearAllMocks());

  it("BUILTIN_LEAD_ORIGINS has the 13 canonical origins incl. the 6 that were missing", () => {
    expect(BUILTIN_LEAD_ORIGINS).toHaveLength(13);
    const slugs = BUILTIN_LEAD_ORIGINS.map((o) => o.slug);
    for (const s of PREVIOUSLY_MISSING) expect(slugs).toContain(s);
  });

  it("falls back to the 13 built-ins while loading / when the table is empty", async () => {
    mockSupabaseQuery(mockFrom, []); // empty result
    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    // Fallback is synchronous (query.data is undefined/empty → built-ins).
    expect(result.current.origins).toHaveLength(13);
    expect(result.current.origins.map((o) => o.slug)).toContain("indicacao");
  });

  it("labelOf / colorOf resolve known slugs and fall back gracefully", async () => {
    mockSupabaseQuery(mockFrom, []);
    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });

    expect(result.current.labelOf("whatsapp")).toBe("WhatsApp");
    expect(result.current.colorOf("whatsapp")).toBe("#25D366");
    // Unknown slug → label is the slug itself, color is the generic fallback.
    expect(result.current.labelOf("nonexistent")).toBe("nonexistent");
    expect(result.current.colorOf("nonexistent")).toBe(FALLBACK_ORIGIN_COLOR);
    // null/undefined → empty label, fallback color.
    expect(result.current.labelOf(null)).toBe("");
    expect(result.current.colorOf(undefined)).toBe(FALLBACK_ORIGIN_COLOR);
  });

  it("returns DB rows when present, and org-custom overrides a built-in slug", async () => {
    mockSupabaseQuery(mockFrom, [
      { slug: "whatsapp", label: "WhatsApp", color: "#25D366", sort_order: 0, organization_id: null },
      // custom row for the org overriding the 'site' built-in label/color
      { slug: "site", label: "Nosso Site", color: "#123456", sort_order: 5, organization_id: "org-test" },
      { slug: "feira_custom", label: "Feira", color: "#abcdef", sort_order: 20, organization_id: "org-test" },
    ]);
    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.origins.some((o) => o.slug === "feira_custom")).toBe(true));
    expect(result.current.labelOf("site")).toBe("Nosso Site");
    expect(result.current.colorOf("site")).toBe("#123456");
    expect(result.current.labelOf("feira_custom")).toBe("Feira");
    expect(mockFrom).toHaveBeenCalledWith("lead_origins");
  });
});
