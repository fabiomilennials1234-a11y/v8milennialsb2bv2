import { describe, expect, it } from "vitest";
import {
  diagnoseCommand,
  parseKeystones,
  parseUsd,
  routeDeviation,
  routeFor,
  customerRepliesSince,
  sessionCommands,
  validateDraft,
  type DiagnosisDraft,
} from "./ticket-diagnosis";

const draft = (over: Partial<DiagnosisDraft> = {}): DiagnosisDraft => ({
  kind: "fix",
  complexity: "baixa",
  summary: "Mover etapa em funil personalizado não dispara o evento.",
  root_cause: "SET stage_id sem stage_key.",
  customer_reply: "",
  recommended_model: "sonnet",
  recommended_effort: "medium",
  resolution_prompt: "x".repeat(60),
  keystones: [{ label: "teste passa", verify: "npx vitest run x" }],
  estimated_cost_usd: "",
  ...over,
});

describe("routeFor", () => {
  it("código nunca cai no Haiku", () => {
    for (const c of ["trivial", "baixa", "media", "alta", "critica"] as const) {
      expect(routeFor("fix", c).model).not.toBe("haiku");
      expect(routeFor("feature", c).model).not.toBe("haiku");
    }
  });

  it("complexidade média em diante é Opus", () => {
    expect(routeFor("fix", "media")).toEqual({ model: "opus", effort: "medium" });
    expect(routeFor("fix", "critica")).toEqual({ model: "opus", effort: "xhigh" });
  });

  it("sem código, o simples vai para o Haiku", () => {
    expect(routeFor("duvida", "trivial")).toEqual({ model: "haiku", effort: "low" });
    expect(routeFor("configuracao", "alta").model).toBe("sonnet");
  });

  it("fable nunca é escolhido pela matriz", () => {
    for (const k of ["fix", "feature", "configuracao", "duvida"] as const)
      for (const c of ["trivial", "baixa", "media", "alta", "critica"] as const)
        expect(routeFor(k, c).model).not.toBe("fable");
  });
});

describe("routeDeviation", () => {
  it("na matriz, acima e abaixo", () => {
    expect(routeDeviation("fix", "baixa", { model: "sonnet", effort: "medium" })).toBe("na-matriz");
    expect(routeDeviation("fix", "baixa", { model: "opus", effort: "low" })).toBe("acima");
    expect(routeDeviation("fix", "alta", { model: "sonnet", effort: "max" })).toBe("abaixo");
    expect(routeDeviation("fix", "baixa", { model: "sonnet", effort: "high" })).toBe("acima");
  });
});

describe("comandos copiáveis", () => {
  it("setup sai em dois comandos, um por colagem", () => {
    expect(sessionCommands({ model: "opus", effort: "high" })).toEqual({
      model: "/model opus",
      effort: "/effort high",
    });
  });
  it("comando de diagnóstico carrega o id do Chamado", () => {
    expect(diagnoseCommand("abc")).toBe("/chamado-diagnosticar abc");
  });
});

describe("parseKeystones", () => {
  it("descarta o que não é keystone", () => {
    expect(
      parseKeystones([{ label: " a ", verify: " b " }, { verify: "sem label" }, null, "x"]),
    ).toEqual([{ label: "a", verify: "b" }]);
    expect(parseKeystones({})).toEqual([]);
  });
});

describe("validateDraft", () => {
  it("rascunho completo passa", () => {
    expect(validateDraft(draft())).toEqual([]);
  });
  it("fix sem root cause é recusado", () => {
    expect(validateDraft(draft({ root_cause: " " }))).toContain(
      "Fix sem root cause é palpite — descreva a causa.",
    );
  });
  it("dúvida pode vir sem root cause", () => {
    expect(validateDraft(draft({ kind: "duvida", root_cause: "" }))).toEqual([]);
  });
  it("sem keystones não há critério de pronto", () => {
    expect(validateDraft(draft({ keystones: [] })).length).toBe(1);
  });
  it("keystone sem verificação é recusado", () => {
    expect(validateDraft(draft({ keystones: [{ label: "ok", verify: "" }] }))).toContain(
      "Cada keystone precisa do que prova e de como verificar.",
    );
  });
  it("custo inválido é recusado", () => {
    expect(validateDraft(draft({ estimated_cost_usd: "abc" }))).toContain("Custo estimado inválido.");
  });
});

describe("parseUsd", () => {
  it("aceita vírgula e arredonda", () => {
    expect(parseUsd("1,239")).toBe(1.24);
    expect(parseUsd("")).toBeNull();
    expect(parseUsd("-2")).toBeNull();
  });
});

describe("customerRepliesSince", () => {
  const since = "2026-10-01T20:05:10Z";
  it("conta só mensagem pública do cliente depois do diagnóstico", () => {
    const comments = [
      { from_staff: false, is_internal: false, created_at: "2026-10-01T18:51:06Z" }, // antes
      { from_staff: true, is_internal: false, created_at: "2026-10-01T20:12:38Z" }, // equipe
      { from_staff: false, is_internal: false, created_at: "2026-10-01T20:24:23Z" }, // conta
      { from_staff: false, is_internal: true, created_at: "2026-10-01T20:30:00Z" }, // interna
    ];
    expect(customerRepliesSince(comments, since)).toBe(1);
  });
  it("sem mensagens, zero", () => {
    expect(customerRepliesSince([], since)).toBe(0);
  });
});
