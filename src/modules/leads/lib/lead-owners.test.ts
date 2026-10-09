import { describe, expect, it } from "vitest";
import { nomesDosDonos, resolveLeadOwners, rotuloDoPapel, type LeadOwnerRow } from "./lead-owners";

const ANA = "11111111-1111-1111-1111-111111111111";
const BIA = "22222222-2222-2222-2222-222222222222";
const CAU = "33333333-3333-3333-3333-333333333333";

function row(id: string, name: string, role: string, added_at = "2026-10-01T00:00:00Z"): LeadOwnerRow {
  return { team_member_id: id, role, is_primary: role !== "co", added_at, team_members: { id, name, avatar_url: null } };
}

describe("resolveLeadOwners — N donos (org com a flag)", () => {
  it("dois donos: principal de venda primeiro, co-dona depois", () => {
    const donos = resolveLeadOwners({
      lead_owners: [row(BIA, "Bia", "co"), row(ANA, "Ana", "venda")],
    });
    expect(donos.map((d) => d.name)).toEqual(["Ana", "Bia"]);
    expect(donos[0].papeis).toEqual(["venda"]);
    expect(donos[1].papeis).toEqual(["co"]);
  });

  it("ordem fixa: venda, pré-venda, co (co mais antigo primeiro)", () => {
    const donos = resolveLeadOwners({
      lead_owners: [
        row(CAU, "Cau", "co", "2026-10-05T00:00:00Z"),
        row(BIA, "Bia", "pre_venda"),
        row("44444444-4444-4444-4444-444444444444", "Duda", "co", "2026-10-02T00:00:00Z"),
        row(ANA, "Ana", "venda"),
      ],
    });
    expect(donos.map((d) => d.name)).toEqual(["Ana", "Bia", "Duda", "Cau"]);
  });

  it("um dono só", () => {
    const donos = resolveLeadOwners({ lead_owners: [row(ANA, "Ana", "venda")] });
    expect(donos).toHaveLength(1);
    expect(donos[0]).toMatchObject({ id: ANA, name: "Ana", papeis: ["venda"] });
  });

  it("mesma pessoa em dois papéis aparece uma vez, com os dois papéis (dedup)", () => {
    const donos = resolveLeadOwners({
      lead_owners: [row(ANA, "Ana", "pre_venda"), row(ANA, "Ana", "venda"), row(BIA, "Bia", "co")],
    });
    expect(donos.map((d) => d.id)).toEqual([ANA, BIA]);
    expect(donos[0].papeis).toEqual(["venda", "pre_venda"]);
  });

  it("principal vem antes mesmo quando o embed chega fora de ordem", () => {
    const donos = resolveLeadOwners({
      lead_owners: [row(BIA, "Bia", "co", "2020-01-01T00:00:00Z"), row(ANA, "Ana", "pre_venda", "2026-12-01T00:00:00Z")],
    });
    expect(donos[0].id).toBe(ANA);
  });

  it("descarta linha sem nome (membro invisível pela RLS) e papel desconhecido", () => {
    const donos = resolveLeadOwners({
      lead_owners: [
        { team_member_id: ANA, role: "venda", is_primary: true, team_members: null },
        row(BIA, "Bia", "dono_misterioso"),
        row(CAU, "Cau", "co"),
      ],
    });
    expect(donos.map((d) => d.name)).toEqual(["Cau"]);
  });
});

describe("resolveLeadOwners — sem embed (org sem a flag): dono único de sempre", () => {
  it("precedência venda → pré-venda → responsável", () => {
    expect(
      resolveLeadOwners({
        sale_responsible: { id: ANA, name: "Ana" },
        pre_sale_responsible: { id: BIA, name: "Bia" },
        responsible: { id: CAU, name: "Cau" },
      }).map((d) => d.name),
    ).toEqual(["Ana"]);
    expect(
      resolveLeadOwners({ pre_sale_responsible: { id: BIA, name: "Bia" }, responsible: { id: CAU, name: "Cau" } }).map(
        (d) => d.name,
      ),
    ).toEqual(["Bia"]);
    expect(resolveLeadOwners({ responsible: { id: CAU, name: "Cau" } })[0]).toMatchObject({ name: "Cau", papeis: [] });
  });

  it("sem dono nenhum: lista vazia", () => {
    expect(resolveLeadOwners({})).toEqual([]);
    expect(resolveLeadOwners(null)).toEqual([]);
  });

  it("embed vazio cai na precedência legada (responsible_id antigo continua aparecendo)", () => {
    expect(resolveLeadOwners({ lead_owners: [], responsible: { id: CAU, name: "Cau" } }).map((d) => d.name)).toEqual([
      "Cau",
    ]);
  });
});

describe("rótulos", () => {
  it("papel principal e lista de nomes", () => {
    const donos = resolveLeadOwners({ lead_owners: [row(ANA, "Ana", "venda"), row(BIA, "Bia", "co"), row(CAU, "Cau", "pre_venda")] });
    expect(donos.map(rotuloDoPapel)).toEqual(["Responsável de venda", "Responsável de pré-venda", "Co-responsável"]);
    expect(nomesDosDonos(donos)).toBe("Ana, Cau e Bia");
    expect(nomesDosDonos(donos.slice(0, 1))).toBe("Ana");
    expect(nomesDosDonos([])).toBe("");
  });
});
