import { describe, expect, it } from "vitest";
import { numeroDoNegocio, telefoneDoNegocio } from "./telefoneDoNegocio";

const principal = { id: "p1", phone: "48999750303", label: "Recepção" };
const compras = { id: "p2", phone: "17981257650", label: "José Luiz - Compras" };

describe("telefoneDoNegocio — nunca chuta com 2+ (Chamado 82c50502)", () => {
  it("usa o telefone escolhido no negócio", () => {
    const r = telefoneDoNegocio({ deal: { leadPhoneId: "p2" }, phones: [principal, compras] });
    expect(r).toEqual({ tipo: "escolhido", telefone: compras });
    expect(numeroDoNegocio(r)).toBe("17981257650");
  });

  it("lead com um telefone só: é esse, sem perguntar", () => {
    const r = telefoneDoNegocio({ deal: { leadPhoneId: null }, phones: [principal] });
    expect(r).toEqual({ tipo: "unico", telefone: principal });
  });

  it("2+ telefones sem escolha: precisa escolher — NÃO devolve o principal", () => {
    const r = telefoneDoNegocio({ deal: { leadPhoneId: null }, phones: [principal, compras] });
    expect(r).toEqual({ tipo: "precisaEscolher", opcoes: [principal, compras] });
    expect(numeroDoNegocio(r)).toBeNull();
  });

  it("escolhido que foi apagado do lead: pergunta de novo", () => {
    const r = telefoneDoNegocio({ deal: { leadPhoneId: "apagado" }, phones: [principal, compras] });
    expect(r.tipo).toBe("precisaEscolher");
  });

  it("sem negócio carregado e 2+ telefones: também pergunta", () => {
    expect(telefoneDoNegocio({ deal: null, phones: [principal, compras] }).tipo).toBe("precisaEscolher");
  });

  it("sem telefone nenhum", () => {
    const r = telefoneDoNegocio({ deal: { leadPhoneId: null }, phones: [] });
    expect(r).toEqual({ tipo: "nenhum" });
    expect(numeroDoNegocio(r)).toBeNull();
  });
});
