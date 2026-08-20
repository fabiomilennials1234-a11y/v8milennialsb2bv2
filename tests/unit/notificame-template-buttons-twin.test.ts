// @vitest-environment node
/**
 * AS DUAS REGRAS DE BOTÃO NÃO PODEM DIVERGIR.
 *
 * As regras da Meta para botões existem em dois lugares, e nenhum dos dois pode
 * sumir:
 *
 *   `src/modules/communication/lib/template-buttons.ts` — avisa o vendedor
 *   enquanto ele digita, em português e apontando o botão pelo nome;
 *
 *   `supabase/functions/_shared/notificame-template-validate.ts` — a última
 *   linha antes da Meta, e o único guarda para quem chama a edge function
 *   direto, sem passar pela tela.
 *
 * Duplicação de regra apodrece em silêncio: alguém afrouxa um teto de um lado,
 * o outro continua barrando, e o sintoma é uma tela que aceita e um servidor que
 * recusa — ou pior, o contrário. Este arquivo roda os MESMOS conjuntos nas duas
 * e falha se elas discordarem.
 *
 * ⚠️ Ele compara VEREDITO (passa / não passa), não a frase: as mensagens são
 * escritas para leitores diferentes de propósito.
 */
import { describe, expect, it } from "vitest";

import {
  montarComponenteDeBotoes,
  problemasDosBotoes,
  type BotaoDoEditor,
} from "../../src/modules/communication/lib/template-buttons";
import {
  validateTemplateDraft,
  type TemplateDraft,
} from "../../supabase/functions/_shared/notificame-template-validate.ts";

/** Os mesmos botões, vistos pelo servidor. */
function comoRascunho(botoes: BotaoDoEditor[]): TemplateDraft {
  const componente = montarComponenteDeBotoes(botoes);
  return {
    name: "teste_gemeo",
    language: "pt_BR",
    category: "UTILITY",
    components: [
      { type: "BODY", text: "Olá" },
      ...(componente ? [componente as unknown as TemplateDraft["components"][number]] : []),
    ],
  };
}

const qr = (texto: string): BotaoDoEditor => ({ tipo: "QUICK_REPLY", texto });

const CASOS: Array<[string, BotaoDoEditor[]]> = [
  ["sem botão", []],
  ["dois de resposta rápida", [qr("Sim"), qr("Não")]],
  ["onze botões", Array.from({ length: 11 }, (_, i) => qr(`Op ${i}`))],
  ["exatamente dez", Array.from({ length: 10 }, (_, i) => qr(`Op ${i}`))],
  ["rótulo de 26 caracteres", [qr("a".repeat(26))]],
  ["rótulo de 25 caracteres", [qr("a".repeat(25))]],
  ["dois telefones", [
    { tipo: "PHONE_NUMBER", texto: "A", telefone: "+551" },
    { tipo: "PHONE_NUMBER", texto: "B", telefone: "+552" },
  ]],
  ["três links", [
    { tipo: "URL", texto: "A", url: "https://a.com" },
    { tipo: "URL", texto: "B", url: "https://b.com" },
    { tipo: "URL", texto: "C", url: "https://c.com" },
  ]],
  ["link sem endereço", [{ tipo: "URL", texto: "A" }]],
  ["telefone sem número", [{ tipo: "PHONE_NUMBER", texto: "A" }]],
  ["link fixo", [{ tipo: "URL", texto: "A", url: "https://a.com" }]],
  ["link variável com exemplo", [
    { tipo: "URL", texto: "A", url: "https://a.com/{{1}}", exemploDaUrl: "4471" },
  ]],
  ["link variável sem exemplo", [{ tipo: "URL", texto: "A", url: "https://a.com/{{1}}" }]],
  ["variável no meio do link", [
    { tipo: "URL", texto: "A", url: "https://a.com/{{1}}/x", exemploDaUrl: "4471" },
  ]],
];

describe("front e servidor concordam sobre botões", () => {
  for (const [nome, botoes] of CASOS) {
    it(nome, () => {
      const front = problemasDosBotoes(botoes).length > 0;
      const servidor = validateTemplateDraft(comoRascunho(botoes))
        .some((p) => p.field === "buttons");

      expect({ caso: nome, front }).toEqual({ caso: nome, front: servidor });
    });
  }
});

/**
 * CONTROLE POSITIVO.
 *
 * Sem isto, um `montarComponenteDeBotoes` que devolvesse `null` para tudo faria
 * o servidor nunca ver botão nenhum, e os 14 casos acima passariam por ausência
 * — verdes dizendo que as regras concordam, quando na verdade uma delas nunca
 * rodou.
 */
describe("o rascunho realmente carrega os botões", () => {
  it("um conjunto válido chega ao servidor como componente BUTTONS", () => {
    const rascunho = comoRascunho([qr("Sim"), { tipo: "URL", texto: "Site", url: "https://a.com" }]);
    const bloco = rascunho.components.find((c) => c.type === "BUTTONS");

    expect(bloco).toBeDefined();
    expect((bloco as { buttons: unknown[] }).buttons).toHaveLength(2);
  });

  it("e um conjunto inválido faz o servidor reclamar de FATO", () => {
    const problemas = validateTemplateDraft(comoRascunho([qr("a".repeat(26))]));
    expect(problemas.map((p) => p.code)).toContain("button_text_too_long");
  });
});
