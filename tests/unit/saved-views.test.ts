import { describe, it, expect } from "vitest";
import { resolveFilters, ME_PLACEHOLDER } from "@/types/saved-views";

describe("resolveFilters", () => {
  it("replaces __me__ placeholder with current user ID", () => {
    const filters = { filterResponsible: ME_PLACEHOLDER, filterOrigin: "all" };
    const resolved = resolveFilters(filters, "user-123");
    expect(resolved.filterResponsible).toBe("user-123");
    expect(resolved.filterOrigin).toBe("all");
  });

  it("leaves filters unchanged when no placeholder", () => {
    const filters = { filterOrigin: "meta_ads", filterTags: ["tag-1"] };
    const resolved = resolveFilters(filters, "user-123");
    expect(resolved).toEqual(filters);
  });

  it("leaves __me__ unchanged when currentUserId is null", () => {
    const filters = { filterResponsible: ME_PLACEHOLDER };
    const resolved = resolveFilters(filters, null);
    expect(resolved.filterResponsible).toBe(ME_PLACEHOLDER);
  });

  it("does not mutate original filters object", () => {
    const filters = { filterResponsible: ME_PLACEHOLDER };
    const resolved = resolveFilters(filters, "user-123");
    expect(filters.filterResponsible).toBe(ME_PLACEHOLDER);
    expect(resolved.filterResponsible).toBe("user-123");
  });
});
