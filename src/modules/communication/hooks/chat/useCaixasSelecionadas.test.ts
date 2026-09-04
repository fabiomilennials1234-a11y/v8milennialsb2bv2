/**
 * A seleção de caixas do `/chat`.
 *
 * O que este arquivo guarda são as três promessas que a onda fez: ninguém acorda
 * com a tela mudada, ninguém fica com a tela em branco, e a caixa que a pessoa
 * perdeu o acesso não pode voltar sozinha.
 */
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCaixasSelecionadas } from "./useCaixasSelecionadas";
import type { InboxBox } from "./types";

const comercial: InboxBox = {
  kind: "whatsapp",
  id: "cx-comercial",
  name: "Comercial",
  status: "connected",
};
const tecnica: InboxBox = {
  kind: "whatsapp",
  id: "cx-tecnica",
  name: "Técnica",
  status: "connected",
};
const caida: InboxBox = {
  kind: "whatsapp",
  id: "cx-caida",
  name: "Antiga",
  status: "disconnected",
};
const insta: InboxBox = {
  kind: "instagram",
  id: "cx-insta",
  name: "@chiquestore",
  status: "connected",
  handle: "chiquestore",
};

beforeEach(() => {
  localStorage.clear();
});

describe("useCaixasSelecionadas — a primeira visita", () => {
  it("nasce com a caixa PREFERIDA, e não com todas", () => {
    // Nascer com todas triplicaria a lista de quem tem três números sem ninguém
    // ter pedido. A capacidade é nova; o padrão não muda.
    const { result } = renderHook(() =>
      useCaixasSelecionadas({
        caixas: [comercial, tecnica],
        caixaPreferida: "cx-tecnica",
        userId: "u1",
      }),
    );

    expect(result.current.marcadas).toEqual(["cx-tecnica"]);
  });

  it("sem preferida, prefere o número CONECTADO ao que está caído", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [caida, comercial], userId: "u1" }),
    );

    expect(result.current.marcadas).toEqual(["cx-comercial"]);
  });

  it("preferida que a pessoa não pode mais ler é ignorada", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({
        caixas: [comercial],
        caixaPreferida: "cx-de-outra-org",
        userId: "u1",
      }),
    );

    expect(result.current.marcadas).toEqual(["cx-comercial"]);
  });

  it("suspenso (deep-link decidindo) não escolhe nada — nem dispara lista", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({
        caixas: [comercial, tecnica],
        caixaPreferida: "cx-comercial",
        userId: "u1",
        suspenso: true,
      }),
    );

    expect(result.current.marcadas).toEqual([]);
  });
});

describe("useCaixasSelecionadas — a tela lembra", () => {
  it("a seleção sobrevive a uma remontagem", () => {
    const primeira = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );
    act(() => primeira.result.current.alternar("cx-tecnica"));
    expect(primeira.result.current.marcadas).toEqual(["cx-comercial", "cx-tecnica"]);
    primeira.unmount();

    const segunda = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );

    expect(segunda.result.current.marcadas).toEqual(["cx-comercial", "cx-tecnica"]);
  });

  it("a memória é POR USUÁRIO — o master em shadow não herda a do outro", () => {
    const um = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );
    act(() => um.result.current.alternar("cx-tecnica"));
    um.unmount();

    const outro = renderHook(() =>
      useCaixasSelecionadas({
        caixas: [comercial, tecnica],
        caixaPreferida: "cx-comercial",
        userId: "u2",
      }),
    );

    expect(outro.result.current.marcadas).toEqual(["cx-comercial"]);
  });

  it("caixa que saiu do conjunto permitido some da seleção sozinha", () => {
    const antes = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );
    act(() => antes.result.current.alternar("cx-tecnica"));
    antes.unmount();

    // A pessoa perdeu o acesso à Técnica entre uma visita e outra.
    const depois = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial], userId: "u1" }),
    );

    expect(depois.result.current.marcadas).toEqual(["cx-comercial"]);
  });

  it("memória corrompida não vira tela em branco", () => {
    localStorage.setItem("chat:caixas-marcadas:u1", "{isto não é json[");

    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial], userId: "u1" }),
    );

    expect(result.current.marcadas).toEqual(["cx-comercial"]);
  });
});

describe("useCaixasSelecionadas — a seleção nunca fica vazia", () => {
  it("desmarcar a ÚLTIMA caixa é sem-op", () => {
    // Lista em branco é indistinguível de "ninguém falou comigo" — o defeito que
    // o épico existe para matar.
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );

    act(() => result.current.alternar("cx-comercial"));

    expect(result.current.marcadas).toEqual(["cx-comercial"]);
  });

  it("desmarcar uma de duas deixa a outra", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );
    act(() => result.current.alternar("cx-tecnica"));

    act(() => result.current.alternar("cx-comercial"));

    expect(result.current.marcadas).toEqual(["cx-tecnica"]);
  });
});

describe("useCaixasSelecionadas — o Instagram é uma caixa como as outras (W5)", () => {
  it("Instagram entra no conjunto junto com os números", () => {
    // Ele abria sozinho enquanto a lista social não respeitava o responsável.
    // A migration 20270929000000 fechou o furo, e a exclusividade saiu.
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica, insta], userId: "u1" }),
    );

    act(() => result.current.alternar("cx-insta"));

    expect(result.current.marcadas).toEqual(["cx-comercial", "cx-insta"]);
  });

  it("marcar um número com o Instagram marcado NÃO desmarca o Instagram", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica, insta], userId: "u1" }),
    );
    act(() => result.current.alternar("cx-insta"));

    act(() => result.current.alternar("cx-tecnica"));

    expect(result.current.marcadas).toEqual(["cx-comercial", "cx-tecnica", "cx-insta"]);
  });

  it("`marcar todas` inclui o Instagram", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica, insta], userId: "u1" }),
    );

    act(() => result.current.marcarTodas());

    expect(result.current.marcadas).toEqual(["cx-comercial", "cx-tecnica", "cx-insta"]);
  });
});

describe("useCaixasSelecionadas — a ordem e o `só esta`", () => {
  it("a ordem é a do SELETOR, não a de marcação", () => {
    // A lista e o menu precisam concordar; a ordem de clique é ruído.
    const { result } = renderHook(() =>
      useCaixasSelecionadas({
        caixas: [comercial, tecnica],
        caixaPreferida: "cx-tecnica",
        userId: "u1",
      }),
    );

    act(() => result.current.alternar("cx-comercial"));

    expect(result.current.marcadas).toEqual(["cx-comercial", "cx-tecnica"]);
  });

  it("`só esta` colapsa o conjunto numa caixa", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial, tecnica], userId: "u1" }),
    );
    act(() => result.current.marcarTodas());

    act(() => result.current.marcarSomente("cx-tecnica"));

    expect(result.current.marcadas).toEqual(["cx-tecnica"]);
  });

  it("org de uma caixa só: uma marcada, e nada mais a decidir", () => {
    const { result } = renderHook(() =>
      useCaixasSelecionadas({ caixas: [comercial], userId: "u1" }),
    );

    expect(result.current.marcadas).toEqual(["cx-comercial"]);
    expect(result.current.caixasMarcadas).toEqual([comercial]);
  });
});
