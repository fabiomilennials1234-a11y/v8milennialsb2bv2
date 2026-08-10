/**
 * Unit tests for deriving the Uazapi managed-proxy region from the instance's
 * own phone number (#1477, PRD #1472).
 *
 * Measured in production: the Uazapi platform already puts every instance on its
 * managed proxy pool (10/10 instances sampled across 8 orgs), but
 * `proxy_managed_city` is EMPTY on 10/10 — the proxy exists and nobody chose
 * where it exits from. A number with DDD 47 can be talking through an IP from
 * anywhere, and geographic incoherence between number and IP is a known
 * automation signal for WhatsApp.
 *
 * Granularity is deliberately STATE, not city: `DDD → UF` is deterministic,
 * `DDD → city` is not (DDD 21 covers the whole Rio metro area; DDD 47 covers
 * Joinville and Blumenau, not the capital). The city is merely the vehicle the
 * API requires to express that state.
 *
 * The catalog is injected — no network here. Slugs always come FROM the catalog,
 * never hardcoded, so a rename on their side cannot break us.
 */

import { describe, it, expect } from "vitest";
import {
  ufFromPhone,
  resolveManagedRegion,
  DDD_TO_UF,
  UF_CAPITAL,
  type CatalogCity,
} from "../../supabase/functions/_shared/whatsapp-proxy-region.ts";

const SP_CATALOG: CatalogCity[] = [
  { value: "campinas", label: "Campinas", state: "sp" },
  { value: "saopaulo", label: "São Paulo", state: "sp" },
  { value: "santos", label: "Santos", state: "sp" },
];

const SC_CATALOG: CatalogCity[] = [
  { value: "balneariocamboriu", label: "Balneário Camboriú", state: "sc" },
  { value: "florianopolis", label: "Florianópolis", state: "sc" },
  { value: "joinville", label: "Joinville", state: "sc" },
];

// ---------------------------------------------------------------------------
// DDD → UF
// ---------------------------------------------------------------------------

describe("ufFromPhone", () => {
  it("maps the DDDs that actually exist in the fleet", () => {
    // Distribution measured in production: 21 → 56 instances, 11 → 13,
    // then ~25 DDDs with 1-6 each.
    expect(ufFromPhone("5521999998888")).toBe("rj");
    expect(ufFromPhone("5511999998888")).toBe("sp");
    expect(ufFromPhone("5548999998888")).toBe("sc");
    expect(ufFromPhone("5547999998888")).toBe("sc");
    expect(ufFromPhone("5551999998888")).toBe("rs");
    expect(ufFromPhone("5519999998888")).toBe("sp");
    expect(ufFromPhone("5527999998888")).toBe("es");
    expect(ufFromPhone("5585999998888")).toBe("ce");
    expect(ufFromPhone("5583999998888")).toBe("pb");
    expect(ufFromPhone("5546999998888")).toBe("pr");
    expect(ufFromPhone("5586999998888")).toBe("pi");
    expect(ufFromPhone("5562999998888")).toBe("go");
    expect(ufFromPhone("5571999998888")).toBe("ba");
    expect(ufFromPhone("5545999998888")).toBe("pr");
    expect(ufFromPhone("5561999998888")).toBe("df");
  });

  it("accepts landline-length numbers (10 digits after the country code)", () => {
    expect(ufFromPhone("554832221100")).toBe("sc");
  });

  it("returns null for a number that is not Brazilian", () => {
    expect(ufFromPhone("14155552671")).toBeNull();
    expect(ufFromPhone("351912345678")).toBeNull();
  });

  it("returns null for absent or malformed input rather than guessing", () => {
    expect(ufFromPhone(null)).toBeNull();
    expect(ufFromPhone("")).toBeNull();
    expect(ufFromPhone("55")).toBeNull();
    expect(ufFromPhone("5500999998888")).toBeNull();
    expect(ufFromPhone("5510999998888")).toBeNull(); // DDD 10 does not exist
  });

  it("tolerates formatting punctuation", () => {
    expect(ufFromPhone("+55 (48) 99999-8888")).toBe("sc");
  });
});

// ---------------------------------------------------------------------------
// Table integrity — these are national facts, not configuration
// ---------------------------------------------------------------------------

describe("DDD_TO_UF / UF_CAPITAL integrity", () => {
  it("covers every valid Brazilian DDD", () => {
    expect(Object.keys(DDD_TO_UF)).toHaveLength(67);
  });

  it("has a capital for all 27 federative units, and for every UF a DDD maps to", () => {
    expect(Object.keys(UF_CAPITAL)).toHaveLength(27);

    const ufsInUse = new Set(Object.values(DDD_TO_UF));
    for (const uf of ufsInUse) {
      expect(UF_CAPITAL[uf], `UF ${uf} has no capital`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Region resolution
// ---------------------------------------------------------------------------

describe("resolveManagedRegion — happy path", () => {
  it("picks the capital of the UF derived from the DDD", () => {
    const r = resolveManagedRegion({ phone: "5511988887777", catalog: SP_CATALOG });

    expect(r).toEqual({
      proxy_managed_country: "br",
      proxy_managed_state: "sp",
      proxy_managed_city: "saopaulo",
    });
  });

  it("matches the capital despite accents in the catalog label", () => {
    const r = resolveManagedRegion({ phone: "5548988887777", catalog: SC_CATALOG });

    expect(r?.proxy_managed_city).toBe("florianopolis");
  });

  it("keeps the number's own state even when the DDD is not the capital's", () => {
    // DDD 47 is Joinville/Blumenau. The state is what matters; the city is only
    // the vehicle the API requires.
    const r = resolveManagedRegion({ phone: "5547988887777", catalog: SC_CATALOG });

    expect(r?.proxy_managed_state).toBe("sc");
    expect(r?.proxy_managed_city).toBe("florianopolis");
  });

  it("always sends country br — the regional pool is Brazil-only today", () => {
    const r = resolveManagedRegion({ phone: "5521988887777", catalog: [
      { value: "riodejaneiro", label: "Rio de Janeiro", state: "rj" },
    ] });

    expect(r?.proxy_managed_country).toBe("br");
  });

  it("takes the slug FROM the catalog, never from our own table", () => {
    const renamed: CatalogCity[] = [
      { value: "sao-paulo-v2", label: "São Paulo", state: "sp" },
    ];

    const r = resolveManagedRegion({ phone: "5511988887777", catalog: renamed });

    expect(r?.proxy_managed_city).toBe("sao-paulo-v2");
  });
});

describe("resolveManagedRegion — fallbacks", () => {
  it("falls back to the first city of the UF when the capital is absent", () => {
    const noCapital: CatalogCity[] = [
      { value: "joinville", label: "Joinville", state: "sc" },
      { value: "blumenau", label: "Blumenau", state: "sc" },
    ];

    const r = resolveManagedRegion({ phone: "5547988887777", catalog: noCapital });

    expect(r?.proxy_managed_state).toBe("sc");
    expect(r?.proxy_managed_city).toBe("joinville");
  });

  it("ignores cities from other states when falling back", () => {
    const mixed: CatalogCity[] = [
      { value: "campinas", label: "Campinas", state: "sp" },
      { value: "joinville", label: "Joinville", state: "sc" },
    ];

    const r = resolveManagedRegion({ phone: "5547988887777", catalog: mixed });

    expect(r?.proxy_managed_city).toBe("joinville");
  });

  it("returns null when the catalog has no city for the UF", () => {
    const r = resolveManagedRegion({ phone: "5547988887777", catalog: SP_CATALOG });

    expect(r).toBeNull();
  });

  it("returns null for an empty or unavailable catalog", () => {
    expect(resolveManagedRegion({ phone: "5511988887777", catalog: [] })).toBeNull();
    expect(resolveManagedRegion({ phone: "5511988887777", catalog: null })).toBeNull();
  });

  it("returns null without a phone, so connecting behaves exactly as before", () => {
    expect(resolveManagedRegion({ phone: null, catalog: SP_CATALOG })).toBeNull();
  });

  it("returns null for a non-Brazilian number instead of guessing a region", () => {
    expect(
      resolveManagedRegion({ phone: "14155552671", catalog: SP_CATALOG })
    ).toBeNull();
  });

  it("tolerates catalog entries with no state by treating them as unusable", () => {
    const stateless: CatalogCity[] = [{ value: "losangeles", label: "Los Angeles" }];

    expect(
      resolveManagedRegion({ phone: "5511988887777", catalog: stateless })
    ).toBeNull();
  });
});
