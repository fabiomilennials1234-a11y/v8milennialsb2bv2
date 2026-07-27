import { describe, it, expect } from "vitest";
import { memberById, memberName, tierLabel, type ResponsibleMember } from "./contextPanelInfoHelpers";

const MEMBERS: ResponsibleMember[] = [
  { id: "m1", name: "Luan Peretti" },
  { id: "m2", name: "Maria Silva", avatar_url: "http://x/a.png" },
];

describe("memberById / memberName", () => {
  it("resolve membro pelo id", () => {
    expect(memberById(MEMBERS, "m2")?.name).toBe("Maria Silva");
    expect(memberName(MEMBERS, "m1")).toBe("Luan Peretti");
  });
  it("id nulo/ausente/desconhecido → null", () => {
    expect(memberById(MEMBERS, null)).toBeNull();
    expect(memberById(MEMBERS, undefined)).toBeNull();
    expect(memberById(MEMBERS, "nope")).toBeNull();
    expect(memberName(MEMBERS, null)).toBeNull();
  });
});

describe("tierLabel", () => {
  it("mapeia tier conhecido pro rótulo", () => {
    // Rótulos vêm de QUALIFICATION_TIER_CONFIG; não fixamos o texto exato,
    // só garantimos que resolve p/ string não-vazia.
    const label = tierLabel("ouro");
    expect(typeof label).toBe("string");
    expect((label ?? "").length).toBeGreaterThan(0);
  });
  it("null/undefined/desconhecido → null", () => {
    expect(tierLabel(null)).toBeNull();
    expect(tierLabel(undefined)).toBeNull();
    expect(tierLabel("inexistente")).toBeNull();
  });
});
