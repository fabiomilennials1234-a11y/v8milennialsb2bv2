import { describe, expect, it } from "vitest";
import { resolveOrgFeatures, type FeatureCatalogEntry } from "./org-features";

const NOW = new Date("2026-10-05T12:00:00Z");
const cat = (key: string, default_enabled = false): FeatureCatalogEntry => ({
  key,
  name: key.toUpperCase(),
  description: null,
  category: "general",
  default_enabled,
});

describe("resolveOrgFeatures — OR-2", () => {
  it("o plano decide o que ele menciona", () => {
    const [f] = resolveOrgFeatures([cat("disparos")], { disparos: true }, [], NOW);
    expect(f).toMatchObject({ enabled: true, source: "plano" });
  });

  it("o extra da org sobrescreve o plano", () => {
    const [f] = resolveOrgFeatures(
      [cat("disparos")],
      { disparos: false },
      [{ feature_key: "disparos", enabled: true, override_reason: "piloto", overridden_at: null, expires_at: null }],
      NOW,
    );
    expect(f).toMatchObject({ enabled: true, source: "extra" });
    expect(f.override?.override_reason).toBe("piloto");
  });

  it("extra expirado não vale e fica visível como expirado", () => {
    const [f] = resolveOrgFeatures(
      [cat("disparos")],
      { disparos: false },
      [{ feature_key: "disparos", enabled: true, override_reason: "x", overridden_at: null, expires_at: "2026-10-01T00:00:00Z" }],
      NOW,
    );
    expect(f).toMatchObject({ enabled: false, source: "plano", override: null });
    expect(f.expiredOverride).not.toBeNull();
  });

  it("o que o plano não menciona cai no padrão do catálogo", () => {
    const [f] = resolveOrgFeatures([cat("oraculo", true)], {}, [], NOW);
    expect(f).toMatchObject({ enabled: true, source: "padrao" });
  });
});
