/**
 * Fatia 1.1 — o `type` do Seamless deixa de ser fixo, e é o SERVIDOR que decide.
 *
 * A fatia 1 chumbou `type: "whatsapp"` dentro de `notificame-channel-start`.
 * A 1.1 abre `instagram` — e o modo de falha que nasce junto é de SEGURANÇA, não
 * de produto: a partir de agora existe um valor vindo do CLIENTE que atravessa
 * até dentro de uma URL que NÓS abrimos no fornecedor, autenticada com o TOKEN
 * DA SUBCONTA daquela org. Se esse valor for string livre, o cliente escolhe o
 * endpoint do popup — e a querystring é montada por concatenação, não por
 * `URLSearchParams`.
 *
 * Por isso a fronteira é uma ALLOWLIST FECHADA (`readSeamlessChannelType`), e não
 * uma validação por rejeição. Este arquivo é o teste dessa fronteira, e cobre os
 * três pontos onde o `type` existe:
 *
 *   1. `readSeamlessChannelType` — o ÚNICO ponto onde valor do cliente vira type.
 *      Allowlist literal: o que não for exatamente `'whatsapp'` ou `'instagram'`
 *      vira `null`, e o chamador cai no default inócuo.
 *   2. `buildSeamlessStartUrl` — a URL de instagram tem que ser a URL de whatsapp
 *      com UM delta e nenhum outro. A asserção é literalmente essa: uma igualdade
 *      contra a URL de whatsapp com o `type` trocado. Qualquer parâmetro a mais,
 *      a menos, ou reordenado reprova.
 *   3. `normalizeSeamlessType` — a direção OPOSTA: lê o discriminante que vem do
 *      FORNECEDOR (`GET /v1/channels`, rota indocumentada, contrato tirado do
 *      SDK). Aqui a tolerância é o certo (alias e caixa variam no terceiro), mas
 *      desconhecido continua sendo `null` — quem chama degrada, nunca adivinha.
 *
 * ⚠️ IMPORTAÇÃO POR NAMESPACE, de propósito. Estes testes nascem VERMELHOS: as
 * duas funções ainda não existem em `_shared/notificame.ts`. Com `import { … }`
 * nomeado, o export ausente é erro de LINK — o arquivo inteiro aborta, o vitest
 * reporta 0 testes executados, e suíte abortada é uma das roupas do verde por
 * ausência. Lendo do namespace, cada caso falha SOZINHO e com frase legível, e
 * os casos que já passam hoje (o envelope da URL) seguem sendo executados como
 * controle positivo.
 *
 * Sem rede.
 */
import { describe, it, expect } from "vitest";
import * as notificame from "../../supabase/functions/_shared/notificame";

const NM = notificame as unknown as Record<string, unknown>;

/**
 * Resolve um export do módulo ou falha COM MOTIVO. É o que troca "o arquivo
 * abortou" por "esta asserção específica está vermelha porque a função ainda não
 * existe" — a diferença entre um vermelho que orienta e um que só assusta.
 */
function fn<T extends (...args: never[]) => unknown>(name: string): T {
  const value = NM[name];
  if (typeof value !== "function") {
    throw new Error(
      `_shared/notificame.ts ainda não exporta \`${name}\` (fatia 1.1). ` +
        `Este vermelho é o contrato pendente, não um teste quebrado.`,
    );
  }
  return value as T;
}

const readSeamlessChannelType = () =>
  fn<(raw: unknown) => "whatsapp" | "instagram" | null>("readSeamlessChannelType");
const normalizeSeamlessType = () =>
  fn<(raw: string | null | undefined) => "whatsapp" | "instagram" | "facebook" | null>(
    "normalizeSeamlessType",
  );

const BASE = notificame.NOTIFICAME_DEFAULT_BASE_URL;
const ORIGIN = "https://torquecrm.com.br";

// ── 1. readSeamlessChannelType — allowlist fechada ───────────────────────────

describe("readSeamlessChannelType — o cliente NÃO escolhe a URL que abrimos no fornecedor", () => {
  it("aceita exatamente 'whatsapp'", () => {
    expect(readSeamlessChannelType()("whatsapp")).toBe("whatsapp");
  });

  it("aceita exatamente 'instagram' — o que a fatia 1.1 abre", () => {
    expect(readSeamlessChannelType()("instagram")).toBe("instagram");
  });

  it("RECUSA 'facebook': o contrato do fornecedor suporta, esta fatia não habilita", () => {
    // `buildSeamlessStartUrl` aceita `facebook` no tipo e o CHECK de
    // `messaging_channels` aceita o valor — mas nenhum caminho o liga na 1.1.
    // Se um dia ligar, é ESTE teste que muda, de propósito: habilitar um canal
    // no fornecedor é decisão, não consequência de um `||` esquecido.
    expect(readSeamlessChannelType()("facebook")).toBeNull();
  });

  it.each(["WhatsApp", "Instagram", "INSTAGRAM", "WHATSAPP", " instagram", "instagram "])(
    "RECUSA %o — allowlist é literal, não normalizadora",
    (raw) => {
      // A tolerância de caixa/alias existe, mas mora em `normalizeSeamlessType`,
      // que lê o FORNECEDOR. Aqui o input é do cliente: tolerar variação é
      // alargar a superfície sem ganho nenhum — o nosso próprio front manda a
      // string exata.
      expect(readSeamlessChannelType()(raw)).toBeNull();
    },
  );

  it.each([
    "whatsapp&type=facebook",
    "instagram&redirect_origin=https://evil.example",
    "instagram#fragment",
    "instagram?x=1",
    "instagram/../../v2/oauth/meta/start",
    "whatsapp\n&type=x",
  ])("RECUSA payload de injeção %o", (raw) => {
    // Este é o caso que dá nome ao arquivo. A querystring do popup é montada por
    // CONCATENAÇÃO (`encodeURIComponent` por campo, não `URLSearchParams`), então
    // um `type` livre é o caminho mais curto entre o body de um POST e a URL que
    // abrimos autenticados com o token da subconta da org.
    expect(readSeamlessChannelType()(raw)).toBeNull();
  });

  it.each([
    ["string vazia", ""],
    ["só espaço", "   "],
    ["null", null],
    ["undefined", undefined],
    ["número", 42],
    ["booleano", true],
    ["objeto", {}],
    ["array", ["instagram"]],
  ])("RECUSA %s", (_label, raw) => {
    expect(readSeamlessChannelType()(raw)).toBeNull();
  });

  it("RECUSA objeto que se disfarça de string (não coage)", () => {
    // `String(raw)` daria 'instagram' aqui. A allowlist tem que checar o TIPO
    // antes do valor — senão qualquer objeto com `toString` entra.
    expect(readSeamlessChannelType()({ toString: () => "instagram" })).toBeNull();
    expect(readSeamlessChannelType()(new String("instagram"))).toBeNull();
  });

  it("é a MESMA função para os dois valores aceitos — sem ramo especial de instagram", () => {
    // Controle de desenho: um `if (raw === 'instagram') return 'instagram'`
    // colado por cima do caminho antigo passaria nos casos acima e deixaria dois
    // vocabulários. A allowlist é uma lista só.
    const read = readSeamlessChannelType();
    expect(new Set(["whatsapp", "instagram"].map(read))).toEqual(
      new Set(["whatsapp", "instagram"]),
    );
  });
});

// ── 2. buildSeamlessStartUrl — envelope idêntico, só o type muda ─────────────

describe("buildSeamlessStartUrl com type=instagram", () => {
  const params = { baseUrl: BASE, companyUuid: "cu-abc-123", redirectOrigin: ORIGIN };

  it("sai com type=instagram e o RESTO do envelope byte-a-byte idêntico ao de whatsapp", () => {
    const wa = notificame.buildSeamlessStartUrl({ ...params, type: "whatsapp" });
    const ig = notificame.buildSeamlessStartUrl({ ...params, type: "instagram" });

    // A asserção que interessa: o delta é UM, e é o esperado. Um parâmetro a
    // mais, a menos ou reordenado reprova aqui — e não num teste de UI daqui a
    // duas fatias, com um canal já nascido e faturável do outro lado.
    expect(ig).toBe(wa.replace("type=whatsapp", "type=instagram"));
    expect(ig).toBe(
      `${BASE}/v2/oauth/meta/start` +
        `?company_uuid=cu-abc-123` +
        `&redirect_origin=https%3A%2F%2Ftorquecrm.com.br` +
        `&type=instagram`,
    );
  });

  it("continua com TRÊS parâmetros e o company_uuid encodado", () => {
    const ig = notificame.buildSeamlessStartUrl({
      ...params,
      companyUuid: "tok/en+com espaço&x=1",
      type: "instagram",
    });
    expect(ig.split("&")).toHaveLength(3);
    expect(ig).toContain("company_uuid=tok%2Fen%2Bcom%20espa%C3%A7o%26x%3D1");
    // O token da subconta não pode virar parâmetro solto na URL que abrimos.
    expect(ig).not.toContain("company_uuid=tok/en");
  });

  it("o default segue sendo whatsapp — cliente antigo e chamada sem type não mudam", () => {
    expect(notificame.buildSeamlessStartUrl(params)).toContain("&type=whatsapp");
  });

  it("mesmo um type forjado que escapasse da allowlist não vira parâmetro extra", () => {
    // Defesa em profundidade: a allowlist é a porta, o `encodeURIComponent` é a
    // fechadura. As duas, porque a primeira é fácil de contornar num refactor.
    const url = notificame.buildSeamlessStartUrl({
      ...params,
      type: "instagram&redirect_origin=https://evil.example" as never,
    });
    expect(url.split("&")).toHaveLength(3);
    expect(url).not.toContain("evil.example&");
    expect(url).toContain("type=instagram%26redirect_origin%3Dhttps%3A%2F%2Fevil.example");
  });
});

// ── 3. normalizeSeamlessType — a direção oposta, lendo o fornecedor ──────────

describe("normalizeSeamlessType — tolerante no alias, intolerante no desconhecido", () => {
  it.each(["instagram", "Instagram", "INSTAGRAM", "ig", "IG", "  instagram  "])(
    "%o ⇒ 'instagram'",
    (raw) => {
      // Aqui a tolerância é o certo: o valor vem do `type`/`channel_type` do
      // `GET /v1/channels`, rota que NÃO está na doc do fornecedor (o contrato
      // veio do SDK). O vocabulário do terceiro pode variar em caixa e alias.
      expect(normalizeSeamlessType()(raw)).toBe("instagram");
    },
  );

  it.each(["whatsapp", "WhatsApp", "WHATSAPP", "wa", "WA", " whatsapp "])(
    "%o ⇒ 'whatsapp'",
    (raw) => {
      expect(normalizeSeamlessType()(raw)).toBe("whatsapp");
    },
  );

  it.each(["facebook", "FB", "messenger", " Facebook "])(
    "%o ⇒ 'facebook' — RECONHECIDO aqui, mesmo não sendo OFERECIDO no start",
    (raw) => {
      // As duas funções deste arquivo respondem a perguntas diferentes e por isso
      // divergem em `facebook`, de propósito:
      //   • `readSeamlessChannelType` = "o cliente PODE PEDIR isto?" ⇒ não.
      //   • `normalizeSeamlessType`   = "o que o fornecedor ESTÁ DIZENDO?" ⇒ é fb.
      // A divergência é load-bearing: o guard de `buildNotificameInstanceRow` só
      // consegue barrar um canal de Facebook entrando em `whatsapp_instances`
      // porque o normalizador sabe nomear `facebook`. Se esta função devolvesse
      // `null` para fb, o guard cairia no caminho degradado e a linha errada
      // seria escrita — que é justamente o defeito que o desenho evita.
      expect(normalizeSeamlessType()(raw)).toBe("facebook");
    },
  );

  it.each([
    ["telegram", "telegram"],
    ["reels", "reels"],
    ["stories", "stories"],
    ["string vazia", ""],
    ["só espaço", "   "],
  ])("%s ⇒ null — quem chama degrada, nunca adivinha", (_label, raw) => {
    expect(normalizeSeamlessType()(raw)).toBeNull();
  });

  it("null e undefined ⇒ null (o fornecedor pode simplesmente não mandar o campo)", () => {
    expect(normalizeSeamlessType()(null)).toBeNull();
    expect(normalizeSeamlessType()(undefined)).toBeNull();
  });

  it("é INVERSA de readSeamlessChannelType nos dois valores que a 1.1 liga", () => {
    // Controle positivo de coerência: os dois vocabulários têm que fechar, senão
    // o `finish` classifica um canal com um nome e o `start` pediu com outro.
    const read = readSeamlessChannelType();
    const norm = normalizeSeamlessType();
    for (const t of ["whatsapp", "instagram"] as const) {
      expect(norm(read(t) as string)).toBe(t);
    }
  });
});

/**
 * ─── O PRIMEIRO CANAL REAL, E OS DOIS DEFEITOS QUE ELE REVELOU ───────────────
 *
 * Em 2026-08-17, 13:31, o Seamless conectou o primeiro canal de verdade na
 * subconta. O vínculo foi RECUSADO por `channel_type_undetermined`, e a trilha
 * registrou `raw_type: null`.
 *
 * A causa: todo o contrato de `/v1/channels` tinha sido derivado do SDK e da
 * doc — nunca de uma resposta observada. O fornecedor declara o tipo na chave
 * `channel`, que não estava entre os aliases lidos, e nomeia o canal oficial de
 * WhatsApp como `whatsapp_business_account`, que não estava entre os aliases
 * reconhecidos.
 *
 * Os dois payloads abaixo são cópias FIÉIS do que a conta devolveu — é a
 * primeira vez que este arquivo testa contra observação em vez de suposição.
 */
const CANAL_IG_REAL = {
  id: "7cd4149f-a173-4eec-809c-03d10f98ad69",
  name: "Gabriel Aurelio Gipp",
  channel: "instagram",
  profile_pic: null,
  instagram: { name: "gabriel.gipp", profile_pic: "https://scontent.cdninstagram.com/..." },
  createdAt: "2026-08-17 13:31:02",
};

const CANAL_WA_REAL = {
  id: "0a8e2a03-9c86-480c-8b1f-98066f511e0c",
  name: "WhatsApp",
  channel: "whatsapp_business_account",
  createdAt: "2026-08-17 12:24:16",
};

const normalizeChannel = () =>
  fn<(raw: unknown) => { id: string; type: string | null } | null>("normalizeChannel");

describe("normalizeChannel — contra o payload REAL do fornecedor", () => {
  it("lê o tipo da chave `channel` — foi o null que abortou o primeiro vínculo", () => {
    const canal = normalizeChannel()(CANAL_IG_REAL);

    expect(canal?.id).toBe("7cd4149f-a173-4eec-809c-03d10f98ad69");
    expect(canal?.type).toBe("instagram");
  });

  it("continua lendo `type` e `channel_type` — os aliases antigos não regridem", () => {
    expect(normalizeChannel()({ id: "a", type: "instagram" })?.type).toBe("instagram");
    expect(normalizeChannel()({ id: "b", channel_type: "whatsapp" })?.type).toBe("whatsapp");
  });

  it("o canal oficial de WhatsApp também declara o tipo em `channel`", () => {
    expect(normalizeChannel()(CANAL_WA_REAL)?.type).toBe("whatsapp_business_account");
  });
});

describe("normalizeSeamlessType — o vocabulário observado do canal oficial", () => {
  it.each(["whatsapp_business_account", "WHATSAPP_BUSINESS_ACCOUNT", " whatsapp_business_account "])(
    "%o ⇒ 'whatsapp' — é como o fornecedor nomeia o canal oficial",
    (raw) => {
      expect(normalizeSeamlessType()(raw)).toBe("whatsapp");
    },
  );

  it("o par completo fecha: payload real de WhatsApp vira o nosso 'whatsapp'", () => {
    // Controle de ponta a ponta das duas funções juntas — é esse encadeamento
    // que o `notificame-channel-finish` executa, e foi ele que quebrou.
    const canal = normalizeChannel()(CANAL_WA_REAL);
    expect(normalizeSeamlessType()(canal?.type)).toBe("whatsapp");
  });

  it("o par completo fecha: payload real de Instagram vira o nosso 'instagram'", () => {
    const canal = normalizeChannel()(CANAL_IG_REAL);
    expect(normalizeSeamlessType()(canal?.type)).toBe("instagram");
  });
});
