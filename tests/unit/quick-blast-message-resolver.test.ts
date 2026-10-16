// @vitest-environment node
/**
 * resolveBlastMessage — variable substitution (Module A, Slice 2).
 *
 * Dumb, pure substitution: {key} → data[key], unknown {key} → "" (never leak a
 * literal placeholder to a lead). Spintax {a|b|c} is NOT a variable and must
 * pass through untouched (handled in Slice 3). Formatting (BRL, first name)
 * lives in the caller's data map, not here.
 */

import { describe, it, expect } from "vitest";

const { resolveBlastMessage } = await import(
  "../../supabase/functions/_shared/quick-blast/message-resolver.ts"
);

describe("resolveBlastMessage — variables", () => {
  it("substitutes known tokens with their values", () => {
    const out = resolveBlastMessage("Oi {primeiro_nome}, da {empresa}!", {
      primeiro_nome: "Pedro",
      empresa: "SacoEcoMulti",
    });
    expect(out).toBe("Oi Pedro, da SacoEcoMulti!");
  });

  it("replaces an unknown token with empty string (no leaked placeholder)", () => {
    const out = resolveBlastMessage("Oi {primeiro_nome} {inexistente}", { primeiro_nome: "Ana" });
    expect(out).toBe("Oi Ana ");
  });

  it("treats null/undefined/empty values as empty string", () => {
    const out = resolveBlastMessage("[{segmento}]", { segmento: null });
    expect(out).toBe("[]");
  });

  it("replaces every occurrence of a token", () => {
    const out = resolveBlastMessage("{nome} {nome} {nome}", { nome: "X" });
    expect(out).toBe("X X X");
  });

  it("coerces numeric values to string", () => {
    const out = resolveBlastMessage("{dias} dias", { dias: 12 });
    expect(out).toBe("12 dias");
  });

  it("returns template unchanged when there are no tokens", () => {
    expect(resolveBlastMessage("sem token aqui", { nome: "X" })).toBe("sem token aqui");
  });
});

describe("resolveBlastMessage — spintax", () => {
  const first = () => 0; // picks the first option
  const last = () => 0.999; // picks the last option

  it("picks the first option with rng→0", () => {
    expect(resolveBlastMessage("{oi|olá|e aí} tudo bem", {}, first)).toBe("oi tudo bem");
  });

  it("picks the last option with rng→~1", () => {
    expect(resolveBlastMessage("{oi|olá|e aí} tudo bem", {}, last)).toBe("e aí tudo bem");
  });

  it("resolves multiple spintax groups independently", () => {
    expect(resolveBlastMessage("{oi|olá} {tudo bem|beleza}", {}, first)).toBe("oi tudo bem");
    expect(resolveBlastMessage("{oi|olá} {tudo bem|beleza}", {}, last)).toBe("olá beleza");
  });

  it("resolves spintax THEN variables (option may contain a variable)", () => {
    const out = resolveBlastMessage("{oi {primeiro_nome}|e aí}", { primeiro_nome: "Pedro" }, first);
    expect(out).toBe("oi Pedro");
  });

  it("does not treat a single-option {token} as spintax", () => {
    // {nome} has no pipe → stays a variable, not a spintax pick
    expect(resolveBlastMessage("{nome}", { nome: "Ana" }, first)).toBe("Ana");
  });

  it("combines spintax and variables in one template", () => {
    const out = resolveBlastMessage("{Oi|Olá} {primeiro_nome}, da {empresa}!", { primeiro_nome: "Pedro", empresa: "SacoEcoMulti" }, last);
    expect(out).toBe("Olá Pedro, da SacoEcoMulti!");
  });
});

// The new wizard (/disparos/novo) inserts {{key}}; the legacy wizard inserts
// {key}. Before the fix the resolver only knew {key}, so "{{primeiro_nome}}"
// left the server as "{Ana}". Each case pins a literal the lead would receive.
describe("resolveBlastMessage — double-brace variables ({{key}})", () => {
  const first = () => 0;
  const last = () => 0.999;

  it("resolves {{primeiro_nome}} to the bare value (no leftover braces)", () => {
    expect(resolveBlastMessage("Olá {{primeiro_nome}}", { primeiro_nome: "Ana" })).toBe("Olá Ana");
  });

  it("still resolves single-brace {primeiro_nome} (legacy wizard)", () => {
    expect(resolveBlastMessage("Olá {primeiro_nome}", { primeiro_nome: "Ana" })).toBe("Olá Ana");
  });

  it("accepts inner spaces like the wizard preview does: {{ nome }}", () => {
    expect(resolveBlastMessage("[{{ nome }}]", { nome: "Ana Souza" })).toBe("[Ana Souza]");
  });

  it("mixes both spellings in one template", () => {
    const out = resolveBlastMessage("{{primeiro_nome}} da {empresa} ({{segmento}})", {
      primeiro_nome: "Ana",
      empresa: "Petshop Amigo",
      segmento: "Petshop",
    });
    expect(out).toBe("Ana da Petshop Amigo (Petshop)");
  });

  it("blanks an unknown {{key}} instead of leaking '{}' or the literal", () => {
    expect(resolveBlastMessage("Oi {{inexistente}}!", {})).toBe("Oi !");
  });

  it("keeps spintax working next to a {{key}}", () => {
    const tpl = "{Oi|Olá} {{primeiro_nome}}, {tudo bem|beleza}?";
    expect(resolveBlastMessage(tpl, { primeiro_nome: "Ana" }, first)).toBe("Oi Ana, tudo bem?");
    expect(resolveBlastMessage(tpl, { primeiro_nome: "Ana" }, last)).toBe("Olá Ana, beleza?");
  });

  it("resolves a {{key}} nested inside a spintax option", () => {
    const out = resolveBlastMessage("{oi {{primeiro_nome}}|e aí}", { primeiro_nome: "Pedro" }, first);
    expect(out).toBe("oi Pedro");
  });
});
