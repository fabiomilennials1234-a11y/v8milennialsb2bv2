import { describe, it, expect } from "vitest";
import {
  LEAD_VISIBILITY_KEYS,
  LEAD_VISIBILITY_OPTIONS,
  isLegacyCombination,
  levelFromPermissions,
  permissionsFromLevel,
  type LeadVisibilityLevel,
} from "./leadVisibility";

const ALL_LEVELS: LeadVisibilityLevel[] = ["own", "own_and_unassigned", "all"];

describe("permissionsFromLevel", () => {
  it("own desliga as três chaves", () => {
    expect(permissionsFromLevel("own")).toEqual({
      "leads.view_all": false,
      "leads.view_unassigned": false,
      "leads.view_subordinates": false,
    });
  });

  it("own_and_unassigned liga só os órfãos", () => {
    expect(permissionsFromLevel("own_and_unassigned")).toEqual({
      "leads.view_all": false,
      "leads.view_unassigned": true,
      "leads.view_subordinates": false,
    });
  });

  it("all liga as três — inclusive view_subordinates, que hoje é redundante", () => {
    expect(permissionsFromLevel("all")).toEqual({
      "leads.view_all": true,
      "leads.view_unassigned": true,
      "leads.view_subordinates": true,
    });
  });

  it("sempre escreve as três chaves, nunca um subconjunto", () => {
    // Gravar parcial deixaria a chave omitida no valor anterior — que foi
    // exatamente o buraco da Bolívar.
    for (const level of ALL_LEVELS) {
      expect(Object.keys(permissionsFromLevel(level)).sort()).toEqual(
        [...LEAD_VISIBILITY_KEYS].sort(),
      );
    }
  });
});

describe("levelFromPermissions", () => {
  it("é o inverso exato de permissionsFromLevel (round-trip)", () => {
    for (const level of ALL_LEVELS) {
      expect(levelFromPermissions(permissionsFromLevel(level))).toBe(level);
    }
  });

  it("mapa vazio cai em own — fail-closed", () => {
    expect(levelFromPermissions({})).toBe("own");
  });

  it("view_subordinates sozinho lê como 'all', porque é o que o RLS entrega", () => {
    // is_responsible_in_same_org() não checa subordinação: libera todo lead com
    // dono na org. A tela precisa dizer a verdade do banco, não a intenção de
    // quem gravou.
    expect(
      levelFromPermissions({
        "leads.view_all": false,
        "leads.view_unassigned": false,
        "leads.view_subordinates": true,
      }),
    ).toBe("all");
  });

  it("reproduz o estado da Bolívar: view_all desligado sozinho ainda é 'all'", () => {
    // Config real de 2026-08-19: organization_feature_defaults tinha só
    // leads.view_all = false; as outras duas seguiam o default global (true).
    expect(
      levelFromPermissions({
        "leads.view_all": false,
        "leads.view_unassigned": true,
        "leads.view_subordinates": true,
      }),
    ).toBe("all");
  });

  it("default global do catálogo (as três true) lê como 'all'", () => {
    expect(
      levelFromPermissions({
        "leads.view_all": true,
        "leads.view_unassigned": true,
        "leads.view_subordinates": true,
      }),
    ).toBe("all");
  });

  it("view_all vence view_unassigned desligado", () => {
    expect(
      levelFromPermissions({
        "leads.view_all": true,
        "leads.view_unassigned": false,
        "leads.view_subordinates": false,
      }),
    ).toBe("all");
  });

  it("undefined não conta como ligado", () => {
    expect(
      levelFromPermissions({
        "leads.view_all": undefined,
        "leads.view_unassigned": undefined,
        "leads.view_subordinates": undefined,
      }),
    ).toBe("own");
  });

  it("ignora chaves de fora do grupo", () => {
    expect(
      levelFromPermissions({
        "leads.view": true,
        "leads.view_general_info": true,
        "leads.delete": true,
      }),
    ).toBe("own");
  });
});

describe("isLegacyCombination", () => {
  it("é falso para tudo que o controle novo produz", () => {
    for (const level of ALL_LEVELS) {
      expect(isLegacyCombination(permissionsFromLevel(level))).toBe(false);
    }
  });

  it("é verdadeiro para o estado da Bolívar", () => {
    expect(
      isLegacyCombination({
        "leads.view_all": false,
        "leads.view_unassigned": true,
        "leads.view_subordinates": true,
      }),
    ).toBe(true);
  });

  it("é verdadeiro para view_subordinates sozinho", () => {
    expect(
      isLegacyCombination({
        "leads.view_all": false,
        "leads.view_unassigned": false,
        "leads.view_subordinates": true,
      }),
    ).toBe(true);
  });

  it("mapa vazio é legado — nenhuma das três chaves está materializada", () => {
    expect(isLegacyCombination({})).toBe(true);
  });
});

describe("LEAD_VISIBILITY_OPTIONS", () => {
  it("cobre os três níveis, sem repetir", () => {
    expect(LEAD_VISIBILITY_OPTIONS.map((o) => o.level)).toEqual(ALL_LEVELS);
  });

  it("está em ordem crescente de alcance", () => {
    // A escala é o significado do controle: fora de ordem, o admin lê errado.
    const reach = LEAD_VISIBILITY_OPTIONS.map(
      (o) => Object.values(permissionsFromLevel(o.level)).filter(Boolean).length,
    );
    expect(reach).toEqual([...reach].sort((a, b) => a - b));
  });

  it("toda opção tem rótulo e descrição", () => {
    for (const option of LEAD_VISIBILITY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});
