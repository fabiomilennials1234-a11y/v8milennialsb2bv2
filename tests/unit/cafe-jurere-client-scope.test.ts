import { describe, expect, it } from "vitest";
import { CAFE_JURERE_ORG_ID, CAFE_JURERE_IMPORT_FLAG, cafeJurereScopeEnabled, cafeJurereClientExclusion } from "../../supabase/functions/_shared/erp/cafe-jurere-client-scope";

describe("recorte de clientes Café Jurerê", () => {
  const owners = new Map<string, string | null>([["12", "member"], ["13", null], ["14", "other-org"]]);
  const members = new Set(["member"]);
  it("exige a organização e a flag booleana", () => {
    expect(cafeJurereScopeEnabled(CAFE_JURERE_ORG_ID, { [CAFE_JURERE_IMPORT_FLAG]: true })).toBe(true);
    expect(cafeJurereScopeEnabled("other-org", { [CAFE_JURERE_IMPORT_FLAG]: true })).toBe(false);
    for (const flags of [null, {}, { [CAFE_JURERE_IMPORT_FLAG]: false }, { [CAFE_JURERE_IMPORT_FLAG]: "true" }]) {
      expect(cafeJurereScopeEnabled(CAFE_JURERE_ORG_ID, flags)).toBe(false);
    }
  });
  it.each(["0", "3"])("aceita situação %s com representante cadastrado", (erpStatus) => {
    expect(cafeJurereClientExclusion({ erpStatus, ownerExternalId: " 12 " }, owners, members)).toBeNull();
  });
  it.each(["1", "2", "", "ATIVO", null, undefined])("rejeita situação %s", (erpStatus) => {
    expect(cafeJurereClientExclusion({ erpStatus, ownerExternalId: "12" }, owners, members)).toBe("situacao");
  });
  it.each(["13", "14", "unknown", "", null, undefined])("rejeita representante %s sem membro da organização", (ownerExternalId) => {
    expect(cafeJurereClientExclusion({ erpStatus: "0", ownerExternalId }, owners, members)).toBe("representante");
  });
  it("mapa ou cadastro vazio não permite importar ninguém", () => {
    const client = { erpStatus: "3", ownerExternalId: "12" };
    expect(cafeJurereClientExclusion(client, new Map(), members)).toBe("representante");
    expect(cafeJurereClientExclusion(client, owners, new Set())).toBe("representante");
  });
});
