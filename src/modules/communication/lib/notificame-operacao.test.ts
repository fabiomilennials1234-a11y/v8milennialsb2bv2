/**
 * A leitura das respostas de operação do canal oficial.
 *
 * ⚠️ NENHUM destes formatos foi medido contra conta viva — a doc do fornecedor
 * mostra o corpo da REQUISIÇÃO e uma imagem da resposta, não o JSON dela. Por
 * isso os leitores são tolerantes e, quando não reconhecem, dizem que não sabem
 * em vez de inventar um veredito.
 */
import { describe, expect, it } from "vitest";

import { lerSaudeDoNumero, lerBloqueados } from "./notificame-operacao";

describe("lerSaudeDoNumero", () => {
  it("reconhece as três cores, venham de onde vierem no corpo", () => {
    // A doc descreve verde/amarelo/vermelho; o caminho exato no JSON é aposta.
    expect(lerSaudeDoNumero({ health_status: "GREEN" })?.nivel).toBe("verde");
    expect(lerSaudeDoNumero({ status: "yellow" })?.nivel).toBe("amarelo");
    expect(lerSaudeDoNumero({ data: { health_status: "RED" } })?.nivel).toBe("vermelho");
  });

  it("formato não reconhecido devolve NULO — não inventa um verde", () => {
    // Um verde inventado diria ao admin que está tudo bem com o número dele.
    // É a mentira mais cara que este leitor poderia contar.
    for (const x of [null, undefined, {}, { foo: "bar" }, "texto", 42]) {
      expect(lerSaudeDoNumero(x)).toBeNull();
    }
  });

  it("guarda o corpo cru para quem for investigar", () => {
    const r = lerSaudeDoNumero({ health_status: "GREEN", extra: 1 });
    expect(r?.cru).toEqual({ health_status: "GREEN", extra: 1 });
  });
});

describe("lerBloqueados", () => {
  it("aceita lista de strings e lista de objetos", () => {
    expect(lerBloqueados(["5544999", "5544888"])).toEqual(["5544999", "5544888"]);
    expect(lerBloqueados({ blocked: [{ phone: "5544999" }] })).toEqual(["5544999"]);
    expect(lerBloqueados({ data: [{ wa_id: "5544888" }] })).toEqual(["5544888"]);
  });

  it("formato desconhecido vira lista vazia, e não um erro", () => {
    // Uma lista vazia é honesta: "não sei quem está bloqueado". Lançar aqui
    // derrubaria o card inteiro por causa de uma seção.
    expect(lerBloqueados(null)).toEqual([]);
    expect(lerBloqueados({ foo: 1 })).toEqual([]);
  });
});
