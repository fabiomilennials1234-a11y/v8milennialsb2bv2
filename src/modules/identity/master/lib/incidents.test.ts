import { describe, expect, it } from "vitest";
import { buildIncidents, normalizeSignature, type IncidentEvent } from "./incidents";

const ev = (over: Partial<IncidentEvent> = {}): IncidentEvent => ({
  origin: "whatsapp",
  severity: "erro",
  organizationId: "o1",
  organizationName: "Org 1",
  signature: "probe_failed",
  title: "Chip não responde",
  detail: null,
  at: "2026-10-05T10:00:00Z",
  ...over,
});

describe("normalizeSignature", () => {
  it("o mesmo erro com ids e números diferentes tem a mesma assinatura", () => {
    expect(normalizeSignature("Lead 123 falhou em 9b2f1c3a-1111-2222-3333-444455556666")).toBe(
      normalizeSignature("lead 987 falhou em 00000000-aaaa-bbbb-cccc-dddddddddddd"),
    );
  });
});

describe("buildIncidents", () => {
  it("MO-4: mesmo erro na mesma org vira um item, ocorrências somam", () => {
    const list = buildIncidents([ev(), ev({ at: "2026-10-05T11:00:00Z" }), ev({ count: 5 })]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ occurrences: 7, lastAt: "2026-10-05T11:00:00Z", scope: "org" });
  });

  it("MO-2: sem org é incidente da plataforma", () => {
    const [i] = buildIncidents([ev({ organizationId: null, organizationName: null })]);
    expect(i.scope).toBe("plataforma");
  });

  it("MO-5: mesmo erro em 3 orgs é um incidente global", () => {
    const list = buildIncidents([ev(), ev({ organizationId: "o2" }), ev({ organizationId: "o3" })]);
    expect(list).toHaveLength(1);
    expect(list[0].scope).toBe("global");
    expect(list[0].affectedOrgs.map((o) => o.id).sort()).toEqual(["o1", "o2", "o3"]);
  });

  it("duas orgs ainda são dois incidentes de org", () => {
    expect(buildIncidents([ev(), ev({ organizationId: "o2" })])).toHaveLength(2);
  });

  it("MO-3: crítico com mais de 10 ocorrências numa org é marcado para chamado", () => {
    const [i] = buildIncidents([ev({ severity: "critico", count: 11 })]);
    expect(i.shouldOpenTicket).toBe(true);
    expect(buildIncidents([ev({ severity: "critico", count: 10 })])[0].shouldOpenTicket).toBe(false);
  });

  it("MO-5: global nunca vira chamado de uma org só", () => {
    const list = buildIncidents(
      ["o1", "o2", "o3"].map((o) => ev({ organizationId: o, severity: "critico", count: 20 })),
    );
    expect(list[0].shouldOpenTicket).toBe(false);
  });

  it("a severidade do incidente é a pior das ocorrências; crítico vem primeiro", () => {
    const list = buildIncidents([
      ev({ signature: "a", severity: "aviso" }),
      ev({ signature: "b", severity: "aviso" }),
      ev({ signature: "b", severity: "critico" }),
    ]);
    expect(list[0]).toMatchObject({ severity: "critico" });
  });
});
