import { describe, it, expect } from "vitest";
import {
  resolveFilters,
  ME_PLACEHOLDER,
  PIPELINE_ENTITY_PREFIX,
  LEGACY_PIPE_ENTITY_TYPES,
  pipelineEntityType,
  isPipelineEntityType,
  parsePipelineEntityType,
  isLegacyPipeEntityType,
} from "@/types/saved-views";

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

// ── entity_type por funil (SCRUM-634) ───────────────────────────────────────

const UUID = "b2f9d1c0-3a4e-4f5b-8c6d-7e8f9a0b1c2d";

describe("pipelineEntityType", () => {
  it("constrói pipeline:{uuid} a partir de um pipelineId", () => {
    expect(pipelineEntityType(UUID)).toBe(`${PIPELINE_ENTITY_PREFIX}${UUID}`);
  });

  it("normaliza uuid pra minúsculas — igualdade de string no banco", () => {
    expect(pipelineEntityType(UUID.toUpperCase())).toBe(
      `${PIPELINE_ENTITY_PREFIX}${UUID}`
    );
  });

  it("lança pra id que não é uuid — bug do chamador não vira linha", () => {
    expect(() => pipelineEntityType("pipe_whatsapp")).toThrow(/UUID/);
    expect(() => pipelineEntityType("")).toThrow(/UUID/);
    expect(() => pipelineEntityType(`${UUID}x`)).toThrow(/UUID/);
  });
});

describe("parsePipelineEntityType / isPipelineEntityType", () => {
  it("parse devolve o uuid de um entity_type canônico", () => {
    expect(parsePipelineEntityType(`pipeline:${UUID}`)).toBe(UUID);
    expect(isPipelineEntityType(`pipeline:${UUID}`)).toBe(true);
  });

  it("round-trip com o construtor", () => {
    expect(parsePipelineEntityType(pipelineEntityType(UUID))).toBe(UUID);
  });

  it("devolve null pra slug legado — view órfã fica invisível, nunca erro", () => {
    for (const legacy of LEGACY_PIPE_ENTITY_TYPES) {
      expect(parsePipelineEntityType(legacy)).toBeNull();
      expect(isPipelineEntityType(legacy)).toBe(false);
    }
  });

  it("devolve null pra 'leads' e pra prefixo com sufixo inválido", () => {
    expect(parsePipelineEntityType("leads")).toBeNull();
    expect(parsePipelineEntityType("pipeline:")).toBeNull();
    expect(parsePipelineEntityType("pipeline:nao-e-uuid")).toBeNull();
    expect(parsePipelineEntityType(`pipeline:${UUID}extra`)).toBeNull();
  });
});

describe("isLegacyPipeEntityType", () => {
  it("reconhece só os 3 slugs legados de funil", () => {
    expect(isLegacyPipeEntityType("pipe_whatsapp")).toBe(true);
    expect(isLegacyPipeEntityType("pipe_confirmacao")).toBe(true);
    expect(isLegacyPipeEntityType("pipe_propostas")).toBe(true);
    expect(isLegacyPipeEntityType("leads")).toBe(false);
    expect(isLegacyPipeEntityType(`pipeline:${UUID}`)).toBe(false);
  });
});
