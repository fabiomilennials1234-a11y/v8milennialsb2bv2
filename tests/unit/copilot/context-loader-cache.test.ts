/**
 * Tests for _shared/copilot/context-loader.ts cache LRU primitives.
 * loadCapabilities + loadConversation + loadLeadData testados via integration
 * (precisam supabase real). Aqui apenas cache.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import "../../helpers/deno-mock";
import {
  getCachedCapabilities,
  setCachedCapabilities,
  bustCapabilitiesCache,
  clearCapabilitiesCache,
  getCacheStats,
} from "../../../supabase/functions/_shared/copilot/context-loader.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const LEAD = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  clearCapabilitiesCache();
});

describe("cache LRU basico", () => {
  it("get retorna null pra chave ausente", () => {
    expect(getCachedCapabilities(ORG)).toBeNull();
    expect(getCachedCapabilities(ORG, LEAD)).toBeNull();
  });

  it("set + get retorna valor armazenado", () => {
    const value = { id: "agent-1", name: "Test" };
    setCachedCapabilities(ORG, LEAD, value);
    expect(getCachedCapabilities(ORG, LEAD)).toEqual(value);
  });

  it("keys diferentes (org+lead) não conflitam", () => {
    setCachedCapabilities(ORG, LEAD, { id: "a" });
    setCachedCapabilities(ORG, "lead-2", { id: "b" });
    setCachedCapabilities("org-2", LEAD, { id: "c" });

    expect(getCachedCapabilities(ORG, LEAD)).toEqual({ id: "a" });
    expect(getCachedCapabilities(ORG, "lead-2")).toEqual({ id: "b" });
    expect(getCachedCapabilities("org-2", LEAD)).toEqual({ id: "c" });
  });

  it("leadId undefined usa key 'default'", () => {
    setCachedCapabilities(ORG, undefined, { id: "default-agent" });
    expect(getCachedCapabilities(ORG)).toEqual({ id: "default-agent" });
    expect(getCachedCapabilities(ORG, undefined)).toEqual({ id: "default-agent" });
  });
});

describe("bust + clear", () => {
  it("bust remove entrada específica", () => {
    setCachedCapabilities(ORG, LEAD, { id: "a" });
    setCachedCapabilities(ORG, "lead-2", { id: "b" });
    bustCapabilitiesCache(ORG, LEAD);
    expect(getCachedCapabilities(ORG, LEAD)).toBeNull();
    expect(getCachedCapabilities(ORG, "lead-2")).toEqual({ id: "b" });
  });

  it("clear remove todas entradas", () => {
    setCachedCapabilities(ORG, LEAD, { id: "a" });
    setCachedCapabilities("org-2", "lead-2", { id: "b" });
    clearCapabilitiesCache();
    expect(getCachedCapabilities(ORG, LEAD)).toBeNull();
    expect(getCachedCapabilities("org-2", "lead-2")).toBeNull();
    expect(getCacheStats().size).toBe(0);
  });
});

describe("TTL expiration", () => {
  it("entrada expira após TTL (5min)", () => {
    vi.useFakeTimers();
    const startMs = 1_700_000_000_000;
    vi.setSystemTime(startMs);

    setCachedCapabilities(ORG, LEAD, { id: "a" });
    expect(getCachedCapabilities(ORG, LEAD)).toEqual({ id: "a" });

    // Avançar 4min — ainda válido
    vi.setSystemTime(startMs + 4 * 60 * 1000);
    expect(getCachedCapabilities(ORG, LEAD)).toEqual({ id: "a" });

    // Avançar pra 5min01s — expirado
    vi.setSystemTime(startMs + 5 * 60 * 1000 + 1000);
    expect(getCachedCapabilities(ORG, LEAD)).toBeNull();

    vi.useRealTimers();
  });
});

describe("LRU eviction (MAX_ENTRIES=200)", () => {
  it("ao atingir MAX, eviction da mais antiga (Map ordem inserção)", () => {
    // Insert 200 entries (encher cache)
    for (let i = 0; i < 200; i++) {
      setCachedCapabilities(`org-${i}`, undefined, { id: i });
    }
    expect(getCacheStats().size).toBe(200);

    // 201ª insert evicta a mais antiga (org-0)
    setCachedCapabilities("org-200", undefined, { id: 200 });
    expect(getCacheStats().size).toBe(200); // ainda 200 (1 evicted, 1 added)
    expect(getCachedCapabilities("org-0")).toBeNull(); // evicted
    expect(getCachedCapabilities("org-200")).toEqual({ id: 200 });
    expect(getCachedCapabilities("org-1")).toEqual({ id: 1 }); // ainda lá
  });
});

describe("getCacheStats", () => {
  it("retorna size + maxEntries + ttlMs", () => {
    const stats = getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.maxEntries).toBe(200);
    expect(stats.ttlMs).toBe(5 * 60 * 1000);
  });

  it("size atualiza com inserts", () => {
    setCachedCapabilities(ORG, LEAD, { id: "a" });
    setCachedCapabilities("org-2", LEAD, { id: "b" });
    expect(getCacheStats().size).toBe(2);
  });
});
