// @vitest-environment node
/**
 * notificame-templates — templates HSM do WhatsApp oficial.
 *
 * ESTE ARQUIVO TAMBÉM NASCE DO ZERO: o módulo tem 622 linhas e nenhum teste do
 * repo o importava (`grep -rn notificame-templates src supabase` só encontra o
 * próprio arquivo).
 *
 * ⚠️ CONTEXTO QUE MUDA COMO LER O QUE SEGUE: nenhum canal está conectado, então
 * NENHUM shape aqui foi exercido contra a conta viva — tudo é derivado de doc.
 * Por isso os casos abaixo cobram TOLERÂNCIA na leitura (envelope em duas
 * formas, item ilegível descartado, status desconhecido virando null) e RIGOR na
 * escrita (as duas redundâncias do fornecedor que parecem engano, o `channel_id`
 * obrigatório por construção). O custo de estar errado na leitura é uma lista
 * vazia; na escrita é um template criado torto que ninguém consegue apagar.
 *
 * A DIVERGÊNCIA DE ROTA (`/v1/templates/{channel_id}` e não `/v2/templates?…`)
 * está documentada no cabeçalho do módulo, com a checagem que a sustenta. Os
 * testes de rota abaixo FIXAM o que o módulo faz hoje — se alguém "corrigir" a
 * rota sem refazer a checagem, ficam vermelhos e forçam a leitura daquele bloco.
 */
import { describe, it, expect } from "vitest";

const denoEnv: Record<string, string | undefined> = { SUPABASE_URL: "http://localhost" };
if (typeof (globalThis as Record<string, unknown>).Deno === "undefined") {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (k: string) => denoEnv[k] },
  };
}

const {
  buildTemplateSendContent,
  buildCreateTemplateBody,
  normalizeTemplate,
  readTemplateListEnvelope,
  listTemplates,
} = await import("../../supabase/functions/_shared/notificame-templates.ts");

const BASE = "https://hub.notificame.example";
const CFG = { baseUrl: BASE, subaccountToken: "sub-token-abc" };
const CHANNEL = "ch_wa_1";

interface FetchCall {
  url: string;
  init: RequestInit;
}
function makeFetch(body: string, status = 200) {
  const calls: FetchCall[] = [];
  const impl = (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    } as unknown as Response);
  };
  return { impl, calls };
}

// ═════════════════════════════════════════════════════════════════════════════
// ENVIO DE TEMPLATE — o item de `contents[]`
// ═════════════════════════════════════════════════════════════════════════════
//
// Isto é o que reabre a janela de 24h. Se um template sai malformado, a Meta
// recusa e o envio some — e é justamente o caminho que a P5 do send-governor
// empurra o operador a usar quando a janela fecha.

describe("buildTemplateSendContent — o shape que a Meta aceita", () => {
  it("emite language como OBJETO, não string (a ponte da assimetria do fornecedor)", () => {
    // A listagem devolve `language: "pt_BR"` STRING; o envio exige
    // `language: {code}`. Quem ler a listagem e repassar direto manda string
    // onde a Meta espera objeto — e a falha é silenciosa.
    const c = buildTemplateSendContent({
      name: "boas_vindas",
      languageCode: "pt_BR",
      components: [],
    });
    expect(c).toEqual({
      type: "template",
      template: { name: "boas_vindas", components: [], language: { code: "pt_BR" } },
    });
  });

  it("mantém o componente MESMO SEM parâmetro (podar é o erro tentador)", () => {
    // Um template aprovado com HEADER e enviado sem o componente HEADER é
    // recusado. O shape da doc manda `parameters: []`.
    const c = buildTemplateSendContent({
      name: "t",
      languageCode: "pt_BR",
      components: [{ type: "header" }, { type: "body", parameters: [] }],
    }) as { template: { components: unknown[] } };
    expect(c.template.components).toEqual([
      { type: "header", parameters: [] },
      { type: "body", parameters: [] },
    ]);
  });

  it("parâmetro de texto só carrega parameter_name em template NAMED", () => {
    // Mandar `parameter_name` num template POSITIONAL é recusado pela Meta.
    const named = buildTemplateSendContent({
      name: "t",
      languageCode: "pt_BR",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana", parameterName: "nome" }] }],
    }) as { template: { components: Array<{ parameters: unknown[] }> } };
    expect(named.template.components[0].parameters).toEqual([
      { type: "text", text: "Ana", parameter_name: "nome" },
    ]);

    const positional = buildTemplateSendContent({
      name: "t",
      languageCode: "pt_BR",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    }) as { template: { components: Array<{ parameters: unknown[] }> } };
    expect(positional.template.components[0].parameters).toEqual([{ type: "text", text: "Ana" }]);
  });

  it("mídia aninha sob a PRÓPRIA chave e action vira flow_token", () => {
    const c = buildTemplateSendContent({
      name: "t",
      languageCode: "pt_BR",
      components: [
        { type: "header", parameters: [{ type: "image", link: "https://x/i.png" }] },
        {
          type: "button",
          subType: "flow",
          index: 0,
          parameters: [{ type: "action", flowToken: "tok-1" }],
        },
      ],
    }) as { template: { components: Array<Record<string, unknown>> } };

    expect(c.template.components[0].parameters).toEqual([
      { type: "image", image: { link: "https://x/i.png" } },
    ]);
    expect(c.template.components[1]).toEqual({
      type: "button",
      sub_type: "flow",
      // `index` vira STRING — a doc do fornecedor o manda assim.
      index: "0",
      parameters: [{ type: "action", action: { flow_token: "tok-1" } }],
    });
  });

  it("botão sem sub_type/index é ERRO DE CONSTRUÇÃO, levantado antes da rede", () => {
    // A doc é explícita: sem isso "o template não irá funcionar" — e a falha é
    // silenciosa. Falhar aqui troca um 422 opaco por um erro legível.
    expect(() =>
      buildTemplateSendContent({
        name: "t",
        languageCode: "pt_BR",
        components: [{ type: "button", index: 0 }],
      })
    ).toThrow(/subtipo/i);

    expect(() =>
      buildTemplateSendContent({
        name: "t",
        languageCode: "pt_BR",
        components: [{ type: "button", subType: "flow" }],
      })
    ).toThrow(/posição/i);
  });

  it("index 0 é POSIÇÃO VÁLIDA, não ausência", () => {
    // O falsy-check ingênuo (`if (!c.index)`) recusaria o primeiro botão de
    // todo template. Este caso existe para travar essa regressão.
    const c = buildTemplateSendContent({
      name: "t",
      languageCode: "pt_BR",
      components: [{ type: "button", subType: "quick_reply", index: 0 }],
    }) as { template: { components: Array<Record<string, unknown>> } };
    expect(c.template.components[0].index).toBe("0");
  });

  it("nome ou idioma ausente para antes de montar qualquer coisa", () => {
    expect(() => buildTemplateSendContent({ name: "  ", languageCode: "pt_BR", components: [] }))
      .toThrow(/nome/i);
    expect(() => buildTemplateSendContent({ name: "t", languageCode: "", components: [] }))
      .toThrow(/idioma/i);
  });

  it("languagePolicy só aparece quando pedida", () => {
    const semPolicy = buildTemplateSendContent({
      name: "t", languageCode: "pt_BR", components: [],
    }) as { template: { language: Record<string, unknown> } };
    expect(semPolicy.template.language).toEqual({ code: "pt_BR" });

    const comPolicy = buildTemplateSendContent({
      name: "t", languageCode: "pt_BR", components: [], languagePolicy: "deterministic",
    }) as { template: { language: Record<string, unknown> } };
    expect(comPolicy.template.language).toEqual({ code: "pt_BR", policy: "deterministic" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CRIAÇÃO — as redundâncias do fornecedor que parecem engano
// ═════════════════════════════════════════════════════════════════════════════

describe("buildCreateTemplateBody", () => {
  it("REPETE o channel_id em `from` e envelopa em contents[] — as duas redundâncias", () => {
    // A implementação "limpa" (template no topo do corpo, sem `from` porque ele
    // já está no caminho) é recusada pelo fornecedor. Este caso fixa as duas.
    const body = buildCreateTemplateBody(CHANNEL, {
      name: "boas_vindas",
      language: "pt_BR",
      category: "UTILITY",
      components: [{ type: "body", text: "Olá {{1}}" }],
    });

    expect(body).toEqual({
      from: CHANNEL,
      contents: [
        {
          template: {
            name: "boas_vindas",
            language: "pt_BR",
            category: "UTILITY",
            components: [{ type: "BODY", text: "Olá {{1}}" }],
          },
        },
      ],
    });
  });

  it("normaliza type/format para maiúsculo e omite o que não foi informado", () => {
    const body = buildCreateTemplateBody(CHANNEL, {
      name: "t", language: "pt_BR", category: "MARKETING",
      components: [{ type: "header", format: "image" }],
    }) as { contents: Array<{ template: { components: Array<Record<string, unknown>> } }> };
    const comp = body.contents[0].template.components[0];
    expect(comp.type).toBe("HEADER");
    expect(comp.format).toBe("IMAGE");
    expect("text" in comp).toBe(false);
    expect("buttons" in comp).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LEITURA — tolerante no acessório, intolerante na identidade
// ═════════════════════════════════════════════════════════════════════════════

describe("normalizeTemplate", () => {
  it("sem `name` devolve null — o envio referencia o template PELO NOME", () => {
    expect(normalizeTemplate({ id: "1", language: "pt_BR" })).toBeNull();
    expect(normalizeTemplate(null)).toBeNull();
    expect(normalizeTemplate("string")).toBeNull();
  });

  it("aceita os aliases de identidade do fornecedor", () => {
    const t = normalizeTemplate({ template_name: "x", template_id: "9", language_code: "en_US" });
    expect(t?.name).toBe("x");
    expect(t?.id).toBe("9");
    expect(t?.language).toBe("en_US");
  });

  it("status/categoria desconhecidos viram null em vez de serem inventados", () => {
    const t = normalizeTemplate({ name: "x", status: "ESTADO_NOVO", category: "OUTRA" });
    expect(t?.status).toBeNull();
    expect(t?.category).toBeNull();

    const ok = normalizeTemplate({ name: "x", status: "approved", category: "utility" });
    expect(ok?.status).toBe("APPROVED");
    expect(ok?.category).toBe("UTILITY");
  });

  it("componente ilegível é descartado sem derrubar o template", () => {
    const t = normalizeTemplate({
      name: "x",
      components: [null, { semTipo: true }, { type: "body", text: "oi" }],
    });
    expect(t?.components).toHaveLength(1);
    expect(t?.components[0]).toMatchObject({ type: "BODY", text: "oi" });
  });
});

describe("readTemplateListEnvelope — distinguir VAZIO de NÃO-ENTENDI", () => {
  it("aceita array cru e envelope {data:[…]}", () => {
    expect(readTemplateListEnvelope([{ name: "a" }])).toEqual([{ name: "a" }]);
    expect(readTemplateListEnvelope({ data: [{ name: "a" }] })).toEqual([{ name: "a" }]);
    expect(readTemplateListEnvelope([])).toEqual([]);
  });

  it("shape desconhecido devolve null, NÃO lista vazia", () => {
    // Os dois renderizam igual na tela e têm causas opostas. Colapsá-los é como
    // "esta org não tem template" some por semanas.
    expect(readTemplateListEnvelope({ templates: [] })).toBeNull();
    expect(readTemplateListEnvelope("texto puro do Go")).toBeNull();
    expect(readTemplateListEnvelope(null)).toBeNull();
  });
});

describe("listTemplates — rota, credencial e veredito pelo corpo", () => {
  it("chama /v1/templates/{channel_id} com o token da SUBCONTA", async () => {
    const f = makeFetch(JSON.stringify({ data: [{ name: "a", status: "APPROVED" }] }));
    const out = await listTemplates(CFG, CHANNEL, f.impl);

    expect(f.calls[0].url).toBe(`${BASE}/v1/templates/${CHANNEL}`);
    expect((f.calls[0].init.headers as Record<string, string>)["X-Api-Token"]).toBe("sub-token-abc");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("a");
  });

  it("channel_id VAZIO lança antes de qualquer chamada", async () => {
    // Sem isso a URL degeneraria para `/v1/templates/`, outra rota, cujo
    // silêncio seria lido como "esta org não tem template nenhum".
    const f = makeFetch("[]");
    await expect(listTemplates(CFG, "", f.impl)).rejects.toThrow(/canal/i);
    await expect(listTemplates(CFG, "   ", f.impl)).rejects.toThrow(/canal/i);
    expect(f.calls).toHaveLength(0);
  });

  it("channel_id com separador de caminho é RECUSADO, não escapado", async () => {
    // Escapá-lo em silêncio mandaria a pergunta para um canal que não é o
    // pedido — cross-tenant dentro da mesma subconta.
    const f = makeFetch("[]");
    await expect(listTemplates(CFG, "ch/../outro", f.impl)).rejects.toThrow(/inválido/i);
    await expect(listTemplates(CFG, "..", f.impl)).rejects.toThrow(/inválido/i);
    expect(f.calls).toHaveLength(0);
  });

  it("Hub404 em HTTP 200 é FALHA — nunca lista vazia", async () => {
    const f = makeFetch('{"error":{"code":"Hub404"}}', 200);
    await expect(listTemplates(CFG, CHANNEL, f.impl)).rejects.toThrow();
  });

  it("shape inesperado vira erro próprio, não zero templates", async () => {
    const f = makeFetch('{"templates":[]}');
    const err = await listTemplates(CFG, CHANNEL, f.impl).catch((e) => e);
    expect((err as { code?: string }).code).toBe("templates_unexpected_shape");
  });

  it("item ilegível é descartado, os legíveis sobrevivem", async () => {
    // Negar a lista inteira por causa de um item sem nome tiraria do ar os que
    // funcionam.
    const f = makeFetch(JSON.stringify({ data: [{ semNome: 1 }, { name: "boa" }] }));
    const out = await listTemplates(CFG, CHANNEL, f.impl);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("boa");
  });
});
