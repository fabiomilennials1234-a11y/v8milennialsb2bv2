import { describe, expect, it } from "vitest";
import { scrubPii, technicalSummary } from "./scrub";

describe("scrubPii", () => {
  it("mascara telefone mantendo 4 primeiros e 4 últimos, como o runtime_logs", () => {
    expect(scrubPii("falhou para 5511999990000")).toBe("falhou para 5511*****0000");
  });

  it("preserva o sufixo de um JID", () => {
    expect(scrubPii("5511999990000@s.whatsapp.net")).toBe("5511*****0000@s.whatsapp.net");
  });

  it("mascara e-mail", () => {
    expect(scrubPii("usuario joao.silva@empresa.com.br não existe")).toBe("usuario j***@empresa.com.br não existe");
  });

  it("mascara CPF e CNPJ formatados", () => {
    expect(scrubPii("cpf 123.456.789-09")).toBe("cpf ***.***.***-09");
    expect(scrubPii("cnpj 12.345.678/0001-95")).toBe("cnpj **.***.***/****-95");
  });

  it("não mexe em número curto nem em código de erro", () => {
    expect(scrubPii("PGRST116 retornou 42 linhas (23505)")).toBe("PGRST116 retornou 42 linhas (23505)");
  });

  it("não corta UUID cujo último bloco é só dígito — e ainda mascara o telefone ao lado", () => {
    expect(scrubPii("/leads/550e8400-e29b-41d4-a716-446655440000 tel 5511987654321")).toBe(
      "/leads/550e8400-e29b-41d4-a716-446655440000 tel 5511*****4321",
    );
  });
});

describe("technicalSummary", () => {
  it("usa nome, código e mensagem — nunca details/hint", () => {
    const summary = technicalSummary({
      code: "23505",
      message: "duplicate key value violates unique constraint \"leads_phone_key\"",
      details: "Key (phone)=(5511999990000) already exists.",
      hint: "o valor é 5511999990000",
    });
    expect(summary).toBe("23505: duplicate key value violates unique constraint \"leads_phone_key\"");
  });

  it("Error nativo leva o nome", () => {
    expect(technicalSummary(new TypeError("x is undefined"))).toBe("TypeError: x is undefined");
  });

  it("ausência de causa não vira string vazia", () => {
    expect(technicalSummary(null)).toBe("sem causa");
    expect(technicalSummary({})).toBe("sem mensagem");
  });
});
