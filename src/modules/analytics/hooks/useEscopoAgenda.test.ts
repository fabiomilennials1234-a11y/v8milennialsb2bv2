import { describe, expect, it } from "vitest";
import { resolverEscopoAgenda } from "./useEscopoAgenda";

describe("escopo da agenda", () => {
  it("membro vê só a dele, sem toggle — mesmo com escolha salva", () => {
    expect(resolverEscopoAgenda({ isAdmin: false, temMembroReal: true, escolhida: "todos" })).toEqual({
      podeAlternar: false, visao: "meu", somenteMeus: true, vendoEquipe: false,
    });
  });

  it("admin começa em Todos", () => {
    expect(resolverEscopoAgenda({ isAdmin: true, temMembroReal: true, escolhida: undefined })).toEqual({
      podeAlternar: true, visao: "todos", somenteMeus: false, vendoEquipe: true,
    });
  });

  it("admin em Meu vê só as dele", () => {
    expect(resolverEscopoAgenda({ isAdmin: true, temMembroReal: true, escolhida: "meu" })).toMatchObject({
      visao: "meu", somenteMeus: true, vendoEquipe: false,
    });
  });

  it("valor salvo inválido cai em Todos", () => {
    expect(resolverEscopoAgenda({ isAdmin: true, temMembroReal: true, escolhida: "x" }).visao).toBe("todos");
  });

  it("master sem membro real: Todos, sem toggle", () => {
    expect(resolverEscopoAgenda({ isAdmin: true, temMembroReal: false, escolhida: "meu" })).toEqual({
      podeAlternar: false, visao: "todos", somenteMeus: false, vendoEquipe: true,
    });
  });
});
