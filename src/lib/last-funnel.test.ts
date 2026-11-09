import { describe, expect, it } from "vitest";
import {
  funilEntryPath,
  lastFunnelKey,
  readLastFunnel,
  writeLastFunnel,
  type KeyValueStorage,
} from "./last-funnel";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("lastFunnelKey", () => {
  it("separa por org e por usuário (máquina compartilhada, usuário em 2 orgs)", () => {
    expect(lastFunnelKey("org1", "u1")).not.toBe(lastFunnelKey("org2", "u1"));
    expect(lastFunnelKey("org1", "u1")).not.toBe(lastFunnelKey("org1", "u2"));
  });

  it("sem org ou sem usuário não há chave (nada é lido nem gravado)", () => {
    expect(lastFunnelKey(null, "u1")).toBeNull();
    expect(lastFunnelKey("org1", undefined)).toBeNull();
  });
});

describe("read/write", () => {
  it("devolve o que foi gravado", () => {
    const s = memoryStorage();
    writeLastFunnel(s, "k", "vendas-b");
    expect(readLastFunnel(s, "k")).toBe("vendas-b");
  });

  it("vazio, ausente ou lixo viram null", () => {
    expect(readLastFunnel(memoryStorage(), "k")).toBeNull();
    expect(readLastFunnel(memoryStorage({ k: "" }), "k")).toBeNull();
    expect(readLastFunnel(memoryStorage({ k: "../../evil" }), "k")).toBeNull();
    expect(readLastFunnel(memoryStorage({ k: "a b" }), "k")).toBeNull();
  });

  it("storage que lança (modo privado) não derruba a tela", () => {
    const quebrado: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastFunnel(quebrado, "k")).toBeNull();
    expect(() => writeLastFunnel(quebrado, "k", "x")).not.toThrow();
  });

  it("sem chave não grava nada", () => {
    const s = memoryStorage();
    writeLastFunnel(s, null, "x");
    expect(s.data).toEqual({});
  });
});

describe("funilEntryPath", () => {
  const slugs = ["whatsapp", "vendas-b", "pos-venda"];

  it("volta ao último funil, o caso do bug (estava no B, foi ao chat)", () => {
    expect(funilEntryPath({ lastSlug: "vendas-b", availableSlugs: slugs })).toBe("/funil/vendas-b");
  });

  it("último funil apagado, inativo ou sem acesso: abre a lista", () => {
    expect(funilEntryPath({ lastSlug: "sumiu", availableSlugs: slugs })).toBe("/funis");
  });

  it("nunca visitou: lista de funis", () => {
    expect(funilEntryPath({ lastSlug: null, availableSlugs: slugs })).toBe("/funis");
  });

  it("sem último e sem padrão: hub", () => {
    expect(funilEntryPath({ lastSlug: null, availableSlugs: slugs })).toBe("/funis");
  });

  it("lista de funis ainda carregando: não confia no último, mantém o comportamento de antes", () => {
    expect(funilEntryPath({ lastSlug: "vendas-b", availableSlugs: [] })).toBe("/funis");
  });
});
