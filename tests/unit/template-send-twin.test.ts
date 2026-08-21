// @vitest-environment node
/**
 * AS DUAS MONTAGENS DE TEMPLATE NÃO PODEM DIVERGIR — issue #1685.
 *
 * A regra que monta os parâmetros de um template aprovado existe no front, é
 * pura e está testada. O executor de workflow roda em outro runtime e não
 * enxerga `src/` — e vai precisar dela para o nó de template (#1688).
 *
 * O front nunca importa de `supabase/functions`: busca exaustiva em `src/`
 * devolve só menções em comentário. O padrão do projeto para regra que os dois
 * runtimes precisam é DUPLICAR COM TESTE GÊMEO — há três precedentes
 * (`blast-planning-twin`, `stage-role-classifier-twin`,
 * `notificame-template-buttons-twin`).
 *
 * ⚠️ POR QUE UMA DIVERGÊNCIA AQUI É CARA: a Meta casa parâmetro por POSIÇÃO e
 * não confere nome. Duas implementações que ordenem diferente entregam o dado
 * errado — o número do pedido no lugar do nome — e ela aceita sem reclamar.
 *
 * Este arquivo roda os MESMOS casos nas duas e falha se elas discordarem.
 */
import { describe, expect, it } from "vitest";

import * as front from "../../src/modules/communication/lib/template-send";
import * as executor from "../../supabase/functions/_shared/template-send.ts";

type Componentes = Parameters<typeof front.montarComponentesDeEnvio>[0]["components"];

const tpl = (components: Componentes) => ({
  name: "t",
  id: "1",
  language: "pt_BR",
  status: "APPROVED" as const,
  category: "UTILITY" as const,
  parameterFormat: "POSITIONAL" as const,
  components,
});

/** Casos escolhidos por já terem custado defeito nesta integração. */
const CASOS: Array<[string, ReturnType<typeof tpl>, Record<string, string>, string | null]> = [
  ["texto simples", tpl([{ type: "BODY", text: "Olá {{1}}" }]), { "1": "Maria" }, null],
  [
    "duas variáveis fora de ordem no objeto",
    tpl([{ type: "BODY", text: "Olá {{1}}, pedido {{2}}" }]),
    { "2": "1234", "1": "Maria" },
    null,
  ],
  ["sem variável", tpl([{ type: "BODY", text: "Olá!" }]), {}, null],
  [
    "cabeçalho de texto com variável",
    tpl([{ type: "HEADER", format: "TEXT", text: "Pedido {{1}}" }, { type: "BODY", text: "Olá {{2}}" }]),
    { "1": "1234", "2": "Maria" },
    null,
  ],
  [
    "cabeçalho de mídia",
    tpl([{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Olá {{1}}" }]),
    { "1": "Maria" },
    "https://storage.example/capa.jpg",
  ],
  [
    "rodapé é ignorado — a Meta não aceita variável nele",
    tpl([{ type: "BODY", text: "Olá" }, { type: "FOOTER", text: "Responda {{1}}" }]),
    {},
    null,
  ],
];

describe("montarComponentesDeEnvio concorda nos dois runtimes", () => {
  for (const [nome, template, valores, midia] of CASOS) {
    it(nome, () => {
      expect(executor.montarComponentesDeEnvio(template, valores, midia))
        .toEqual(front.montarComponentesDeEnvio(template, valores, midia));
    });
  }
});

describe("as leituras auxiliares concordam", () => {
  const comImagem = tpl([
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://x/y.jpg"] } },
    { type: "BODY", text: "Olá {{1}}" },
  ]);

  it("formato de mídia do cabeçalho", () => {
    expect(executor.formatoDeMidiaDoCabecalho(comImagem))
      .toBe(front.formatoDeMidiaDoCabecalho(comImagem));
  });

  it("mídia de exemplo do cabeçalho", () => {
    expect(executor.midiaDeExemploDoCabecalho(comImagem))
      .toBe(front.midiaDeExemploDoCabecalho(comImagem));
  });

  it("pendências de envio", () => {
    expect(executor.pendenciasDeEnvio(comImagem, {})).toEqual(front.pendenciasDeEnvio(comImagem, {}));
    expect(executor.pendenciasDeEnvio(comImagem, { "1": "Maria" }, "https://x/y.jpg"))
      .toEqual(front.pendenciasDeEnvio(comImagem, { "1": "Maria" }, "https://x/y.jpg"));
  });
});

/**
 * CONTROLE POSITIVO.
 *
 * Sem isto, dois módulos que devolvessem sempre `[]` fariam todos os casos acima
 * passarem — verdes dizendo que as regras concordam, quando na verdade nenhuma
 * das duas faz nada.
 */
describe("as duas produzem resultado de fato", () => {
  it("um template com duas variáveis produz dois parâmetros, na ordem do texto", () => {
    const t = tpl([{ type: "BODY", text: "Olá {{1}}, pedido {{2}}" }]);
    const r = executor.montarComponentesDeEnvio(t, { "2": "1234", "1": "Maria" });

    expect(r).toHaveLength(1);
    expect(r[0].parameters).toEqual([
      { type: "text", text: "Maria" },
      { type: "text", text: "1234" },
    ]);
  });
});
