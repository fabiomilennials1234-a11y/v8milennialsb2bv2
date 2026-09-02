// @vitest-environment node
/**
 * {primeiro_nome} — derivação canônica do primeiro nome.
 *
 * Duas cópias da regra (Deno em `_shared/lead-name.ts`, front em
 * `@/shared/format/first-name.ts`) precisam concordar token a token: a prévia
 * no CRM tem que bater com o que o motor de envio produz.
 */

import { describe, it, expect } from "vitest";
import { personalizationFirstName as frontFirstName } from "../../src/shared/format/first-name";

const { personalizationFirstName: denoFirstName } = await import(
  "../../supabase/functions/_shared/lead-name.ts"
);

const IMPLS: Array<[string, (v: string | null | undefined) => string]> = [
  ["deno", denoFirstName],
  ["front", frontFirstName],
];

describe.each(IMPLS)("personalizationFirstName (%s)", (_label, firstName) => {
  it("devolve o primeiro token de um nome completo", () => {
    expect(firstName("Lucia Pinheiro Da Silva")).toBe("Lucia");
  });

  it("ignora espaços extras", () => {
    expect(firstName("   Ana   Maria  ")).toBe("Ana");
  });

  it("preserva um nome único", () => {
    expect(firstName("Lucia")).toBe("Lucia");
  });

  it("normaliza nome em caixa alta (Meta Ads / planilha)", () => {
    expect(firstName("LUCIA PINHEIRO DA SILVA")).toBe("Lucia");
    expect(firstName("JOSÉ")).toBe("José");
  });

  it("não mexe em caixa mista nem em minúsculas", () => {
    expect(firstName("McDonald Silva")).toBe("McDonald");
    expect(firstName("lucia silva")).toBe("lucia");
  });

  it("suprime nome-placeholder — nunca vaza 'WhatsApp' para o cliente", () => {
    expect(firstName("WhatsApp 2952")).toBe("");
    expect(firstName("Lead 1720000000000")).toBe("");
    expect(firstName("Lead 2952")).toBe("");
  });

  it("não confunde nome real que começa com Lead/WhatsApp", () => {
    expect(firstName("Leandro Souza")).toBe("Leandro");
    expect(firstName("Lead Silva")).toBe("Lead");
  });

  it("devolve vazio para nome ausente", () => {
    expect(firstName(null)).toBe("");
    expect(firstName(undefined)).toBe("");
    expect(firstName("   ")).toBe("");
  });

  it("não normaliza token de uma letra nem token sem letras", () => {
    expect(firstName("A Silva")).toBe("A");
    expect(firstName("48999990000")).toBe("48999990000");
  });
});
