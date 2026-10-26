import { describe, it, expect } from "vitest";
import { hasOwner, prepareLeadForCreate } from "./lead-create-payload";

const member = { teamMemberId: "tm-rafaeli", isAdmin: false };
const admin = { teamMemberId: "tm-admin", isAdmin: true };
const novoId = () => "id-novo";

describe("prepareLeadForCreate", () => {
  it("🔑 membro sem dono vira o responsável — o lead fica visível para ele", () => {
    const out = prepareLeadForCreate({ name: "Lead", responsible_id: null }, member, novoId);
    expect(out.responsible_id).toBe("tm-rafaeli");
  });

  it("responsável em branco ('') também conta como sem dono", () => {
    const out = prepareLeadForCreate({ name: "Lead", responsible_id: "" }, member, novoId);
    expect(out.responsible_id).toBe("tm-rafaeli");
  });

  it("dono escolhido na tela não é sobrescrito", () => {
    const out = prepareLeadForCreate({ name: "Lead", responsible_id: "tm-fernanda" }, member, novoId);
    expect(out.responsible_id).toBe("tm-fernanda");
  });

  it.each(["sdr_id", "closer_id", "pre_sale_responsible_id", "sale_responsible_id"])(
    "dono em %s também impede o padrão",
    (column) => {
      const out = prepareLeadForCreate({ name: "Lead", [column]: "tm-x" }, member, novoId);
      expect(out.responsible_id).toBeUndefined();
    },
  );

  it("admin não ganha dono: ele já vê tudo", () => {
    const out = prepareLeadForCreate({ name: "Lead", responsible_id: null }, admin, novoId);
    expect(out.responsible_id).toBeNull();
  });

  it("sem team member do criador, não inventa dono", () => {
    const out = prepareLeadForCreate({ name: "Lead" }, { teamMemberId: null, isAdmin: false }, novoId);
    expect(out).not.toHaveProperty("responsible_id");
  });

  it("gera o id no cliente, para o INSERT dispensar RETURNING", () => {
    expect(prepareLeadForCreate({ name: "Lead" }, member, novoId).id).toBe("id-novo");
  });

  it("respeita um id já informado", () => {
    expect(prepareLeadForCreate({ name: "Lead", id: "meu-id" }, member, novoId).id).toBe("meu-id");
  });

  it("não altera os demais campos", () => {
    const out = prepareLeadForCreate({ name: "Lead", company: "ACME", phone: "11" }, member, novoId);
    expect(out).toMatchObject({ name: "Lead", company: "ACME", phone: "11" });
  });
});

describe("hasOwner", () => {
  it("vazio, nulo e string vazia não são dono", () => {
    expect(hasOwner({})).toBe(false);
    expect(hasOwner({ responsible_id: null, sdr_id: "" })).toBe(false);
  });
});
