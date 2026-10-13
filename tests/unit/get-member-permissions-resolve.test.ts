import { describe, expect, it } from "vitest";
import { resolvePermissions, type FeatureRow } from "../../supabase/functions/get-member-permissions/resolve";

/**
 * A tela tem de concordar com `has_feature_permission` (SQL): override do
 * membro → padrão da org → catálogo. O padrão da org faltava, e
 * `leads.edit_document` ligado para a Café Jurerê inteira seguia travado na
 * ficha enquanto o banco aceitava a gravação.
 */
const features: FeatureRow[] = [
  { key: "leads.edit_document", is_admin_only: false, default_value: false },
  { key: "leads.view_all", is_admin_only: false, default_value: true },
  { key: "settings.billing", is_admin_only: true, default_value: false },
];

const base = {
  features,
  isAdmin: false,
  isMaster: false,
  memberOverrides: new Map<string, boolean>(),
  orgDefaults: new Map<string, boolean>(),
};

describe("resolvePermissions", () => {
  it("sem override nem padrão da org, vale o catálogo", () => {
    expect(resolvePermissions(base)).toEqual({
      "leads.edit_document": false,
      "leads.view_all": true,
      "settings.billing": false,
    });
  });

  it("padrão da org vence o catálogo, nos dois sentidos", () => {
    const r = resolvePermissions({
      ...base,
      orgDefaults: new Map([
        ["leads.edit_document", true],
        ["leads.view_all", false],
      ]),
    });
    expect(r["leads.edit_document"]).toBe(true);
    expect(r["leads.view_all"]).toBe(false);
  });

  it("override do membro vence o padrão da org", () => {
    const r = resolvePermissions({
      ...base,
      orgDefaults: new Map([["leads.edit_document", true]]),
      memberOverrides: new Map([["leads.edit_document", false]]),
    });
    expect(r["leads.edit_document"]).toBe(false);
  });

  it("admin-only segue falso para membro, mesmo com padrão da org ligado", () => {
    const r = resolvePermissions({ ...base, orgDefaults: new Map([["settings.billing", true]]) });
    expect(r["settings.billing"]).toBe(false);
  });

  it("admin e master têm tudo", () => {
    for (const who of [{ isAdmin: true }, { isMaster: true }]) {
      const r = resolvePermissions({ ...base, ...who, orgDefaults: new Map([["leads.view_all", false]]) });
      expect(Object.values(r).every(Boolean)).toBe(true);
    }
  });
});
