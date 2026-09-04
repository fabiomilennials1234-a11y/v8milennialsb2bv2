import { describe, it, expect } from "vitest";
import {
  ehIdentificadorOculto,
  legendaDoTelefone,
  rotuloDeIdentificadorOculto,
  telefoneParaExibicao,
} from "./identificadorOculto";

describe("ehIdentificadorOculto", () => {
  it("reconhece LID (14–18 dígitos), com e sem sufixo", () => {
    expect(ehIdentificadorOculto("210028246085780")).toBe(true);
    expect(ehIdentificadorOculto("210028246085780@lid")).toBe(true);
    expect(ehIdentificadorOculto("35893192732870")).toBe(true);
    expect(ehIdentificadorOculto("120363404701403742@newsletter")).toBe(true);
  });

  it("não toca em telefone brasileiro, com ou sem país", () => {
    expect(ehIdentificadorOculto("5548999998888")).toBe(false);  // 13
    expect(ehIdentificadorOculto("554899998888")).toBe(false);   // 12
    expect(ehIdentificadorOculto("48999998888")).toBe(false);    // 11
    expect(ehIdentificadorOculto("5548999998888@s.whatsapp.net")).toBe(false);
    expect(ehIdentificadorOculto("5548999998888:12@s.whatsapp.net")).toBe(false);
  });

  it("vazio e nulo não são identificador oculto", () => {
    expect(ehIdentificadorOculto("")).toBe(false);
    expect(ehIdentificadorOculto(null)).toBe(false);
    expect(ehIdentificadorOculto(undefined)).toBe(false);
  });
});

describe("rotuloDeIdentificadorOculto", () => {
  it("rotula LID mantendo um discriminador", () => {
    // Sem o sufixo, 514 conversas viram 514 linhas idênticas.
    expect(rotuloDeIdentificadorOculto("210028246085780"))
      .toBe("Contato sem número · 085780");
    expect(rotuloDeIdentificadorOculto("35893192732870"))
      .toBe("Contato sem número · 732870");
  });

  it("dois LIDs diferentes produzem rótulos diferentes", () => {
    expect(rotuloDeIdentificadorOculto("210028246085780"))
      .not.toBe(rotuloDeIdentificadorOculto("129545055252575"));
  });

  it("canal do WhatsApp tem nome próprio", () => {
    expect(rotuloDeIdentificadorOculto("120363404701403742@newsletter"))
      .toBe("Canal do WhatsApp");
  });

  it("telefone de verdade devolve null — quem chama exibe o que já exibia", () => {
    expect(rotuloDeIdentificadorOculto("5548999998888")).toBeNull();
    expect(rotuloDeIdentificadorOculto(null)).toBeNull();
  });
});

describe("legendaDoTelefone", () => {
  it("explica a ausência em vez de repetir o título", () => {
    expect(legendaDoTelefone("210028246085780")).toBe("Número oculto pelo WhatsApp");
    // Sem discriminador: no subtítulo ele seria eco do nome logo acima.
    expect(legendaDoTelefone("129545055252575")).toBe(legendaDoTelefone("210028246085780"));
  });

  it("telefone de verdade passa intocado", () => {
    expect(legendaDoTelefone("5548999998888")).toBe("5548999998888");
    expect(legendaDoTelefone(null)).toBeNull();
  });
});

describe("telefoneParaExibicao", () => {
  it("troca o código pelo rótulo e preserva o telefone", () => {
    expect(telefoneParaExibicao("210028246085780")).toBe("Contato sem número · 085780");
    expect(telefoneParaExibicao("5548999998888")).toBe("5548999998888");
  });

  it("preserva nulo e vazio sem inventar rótulo", () => {
    expect(telefoneParaExibicao(null)).toBeNull();
    expect(telefoneParaExibicao("")).toBe("");
  });
});
