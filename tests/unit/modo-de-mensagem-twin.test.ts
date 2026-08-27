// @vitest-environment node
/**
 * O MODO DO NÓ PRECISA SER O MESMO NOS DOIS LADOS.
 *
 * ─── A DIVERGÊNCIA QUE ESTE ARQUIVO IMPEDE ──────────────────────────────────
 *
 * O painel deriva o modo de `templateMode` com recuo para o `useTemplate`
 * legado. O executor precisa derivar igual — e não pode importar a função do
 * front, porque `supabase/functions/` é Deno e não resolve o alias `@/`. São
 * duas implementações da mesma regra, que é o acordo que se quebra em silêncio.
 *
 * ⚠️ E A QUEBRA SERIA INVISÍVEL DO PIOR JEITO: o nó apareceria em modo template
 * na tela, com o template escolhido e a prévia certa, e sairia como texto no
 * envio — ou o contrário. Nada fica vermelho, e o cliente descobre pelo que o
 * lead recebeu.
 *
 * Prior art do padrão: `decisao-de-envio-twin`, `instance-routing-twin`,
 * `template-send-twin`, `notificame-template-buttons-twin`.
 */
import { describe, expect, it } from "vitest";

import { modoDeMensagemDoNo } from "../../src/contracts/workflows/modo-de-mensagem";
import { modoDoNo } from "../../supabase/functions/_shared/decisao-de-envio.ts";

/**
 * As entradas que importam: as duas chaves, presentes e ausentes, mais os
 * valores que um dia estiveram gravados em produção.
 */
const CASOS: Array<{ nome: string; config: Record<string, unknown> }> = [
  { nome: "nada declarado", config: {} },
  { nome: "modo livre", config: { templateMode: "free" } },
  { nome: "template de campanha", config: { templateMode: "campaign_template" } },
  { nome: "gerar com IA", config: { templateMode: "ai" } },
  { nome: "template da Meta", config: { templateMode: "meta_template" } },
  { nome: "legado ligado", config: { useTemplate: true } },
  { nome: "legado desligado", config: { useTemplate: false } },
  // O par real gravado pelo painel: `handleModeChange` escreve os dois juntos.
  { nome: "par completo", config: { templateMode: "meta_template", useTemplate: true } },
  // A contradição possível: o modo manda, e a chave legada é ignorada.
  { nome: "contradição", config: { templateMode: "free", useTemplate: true } },
  // Modo que ainda não existe: os dois têm de cair em texto, não em template.
  { nome: "modo desconhecido", config: { templateMode: "modo_do_futuro" } },
  { nome: "modo não-string", config: { templateMode: 7 } },
  { nome: "legado não-booleano", config: { useTemplate: "sim" } },
];

describe("front e executor derivam o mesmo modo", () => {
  for (const { nome, config } of CASOS) {
    it(nome, () => {
      const front = modoDeMensagemDoNo(config) === "meta_template" ? "template" : "texto";
      expect(modoDoNo(config)).toBe(front);
    });
  }
});

describe("o veredito, explicitado", () => {
  it("só `meta_template` — declarado ou derivado do legado — manda template", () => {
    const mandamTemplate = CASOS.filter(({ config }) => modoDoNo(config) === "template");
    expect(mandamTemplate.map((c) => c.nome)).toEqual([
      "template da Meta",
      "legado ligado",
      "par completo",
    ]);
  });
});
