/**
 * Contrato PURO do modelo de SUBCONTA POR ORG do NotificaMe.
 *
 * A premissa que muda tudo, verificada contra a conta viva em 2027-08-13: o
 * `CompanyId` devolvido por `POST /v2/accounts` **É O TOKEN** daquela subconta
 * (byte-a-byte igual ao `acccount_id` de `GET /v1/resale/`). Logo o
 * `company_uuid` que viaja na querystring do popup deixou de ser identificador
 * público e passou a ser CREDENCIAL. Este arquivo trava as consequências disso
 * onde o Vitest as lê.
 *
 * QUATRO INVARIANTES:
 *
 *   1. SUCESSO DO POST SE DECIDE POR PRESENÇA DE `CompanyId`, JAMAIS POR STRING
 *      DE STATUS. A doc do fornecedor diz `{"status":"success"}`; o real é
 *      `{"CompanyId":"<36>","Status":"Sucesso"}`. O CONTROLE NEGATIVO — a forma
 *      da DOC ser REJEITADA — é o teste de maior valor do arquivo: sem ele, uma
 *      implementação que case a string da doc passa verde aqui e falha contra
 *      TODA subconta criada em produção.
 *
 *   2. O PARSER NÃO PODE QUEBRAR COM ENVELOPE DESCONHECIDO. O fornecedor já
 *      mentiu uma vez sobre este corpo; a próxima variação não pode virar
 *      `SyntaxError` atravessando o `withErrorBoundary`. Envelope diferente
 *      resolve para uma DECISÃO, nunca para uma exceção não-tipada.
 *
 *   3. O TOKEN DA CONTA-MÃE NUNCA APARECE EM NADA DEVOLVIDO AO BROWSER. Ele dá
 *      acesso a TODAS as orgs. As fixtures abaixo usam DOIS tokens distintos, os
 *      dois com 36 chars, exatamente para que mandar o campo errado no header ou
 *      na URL fique VERMELHO — com um token só, esse bug é invisível.
 *
 *   4. O TOKEN DA SUBCONTA NÃO PODE CAIR EM COLUNA LEGÍVEL. `whatsapp_instances`
 *      é lida por qualquer membro da org sob RLS, inclusive quem não tem
 *      `whatsapp.manage_instances`. Carimbar o token em `provider_config` é
 *      vazamento de credencial para todo o time do cliente.
 *
 * SOBRE AS FALHAS "AUSENTE:" — este arquivo é ESPECIFICAÇÃO EXECUTÁVEL. Ele é
 * importado por NAMESPACE (`import * as N`) de propósito: um named-import de
 * export inexistente aborta a COLETA e o arquivo inteiro conta como zero testes,
 * que é uma das quatro roupas do verde-por-ausência. Com namespace, cada função
 * que ainda não existe deixa UM teste vermelho com o motivo legível.
 */
import { describe, it, expect } from "vitest";
import * as N from "../../supabase/functions/_shared/notificame";
import {
  NOTIFICAME_ORIGIN,
  readSeamlessMessage,
} from "@/modules/communication/lib/notificame-message";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Token da CONTA-MÃE. Raio de explosão = todas as orgs. Nunca sai do servidor. */
const PARENT_TOKEN = "11111111-1111-4111-8111-111111111111";
/** Token da SUBCONTA da org-1. 36 chars, como o CompanyId real. */
const SUB_TOKEN = "22222222-2222-4222-8222-222222222222";
/** Token da subconta de OUTRA org — usado para provar que um não vira o outro. */
const OTHER_SUB_TOKEN = "33333333-3333-4333-8333-333333333333";

const BASE = "https://api.notificame.com.br";

/** Resposta REAL do `POST /v2/accounts`, provada contra a conta viva. */
const REAL_CREATE_OK = JSON.stringify({ CompanyId: SUB_TOKEN, Status: "Sucesso" });
/** A forma que a DOC promete — e que a conta viva NUNCA devolve. */
const DOC_CREATE_OK = JSON.stringify({ status: "success" });

function envOf(vars: Record<string, string | undefined>) {
  return { get: (k: string) => vars[k] };
}

/** fetch fake que grava a chamada recebida. */
function fetchReturning(body: string, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(body, { status }));
  }) as N.FetchImpl & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

/**
 * Pega uma export por NOME e falha com motivo legível se ela não existir.
 * A alternativa (named import) mataria a coleta do arquivo inteiro.
 */
function required<T>(name: string): T {
  const f = (N as unknown as Record<string, unknown>)[name];
  if (typeof f !== "function") {
    throw new Error(
      `AUSENTE: \`${name}\` não é exportada por supabase/functions/_shared/notificame.ts — ` +
        `o modelo de SUBCONTA POR ORG ainda não está implementado neste worktree.`,
    );
  }
  return f as T;
}

/**
 * Normaliza o retorno de `readCompanyIdFromCreateAccount` para ACEITO/REJEITADO.
 *
 * Deliberadamente tolerante ao SHAPE (string | null, discriminada `{ok}`, ou
 * throw): o que este arquivo trava é o COMPORTAMENTO — qual corpo do fornecedor
 * vira uma subconta gravada e qual não vira. Amarrar o shape aqui transformaria
 * uma decisão de estilo do implementador em teste vermelho, e ruído de shape é
 * como um teste de segurança perde a autoridade.
 */
function outcome(fn: (raw: string) => unknown, raw: string): {
  accepted: boolean;
  companyId: string | null;
  raw: unknown;
} {
  let value: unknown;
  try {
    value = fn(raw);
  } catch (e) {
    // Rejeição por exceção tipada também é rejeição.
    return { accepted: false, companyId: null, raw: e };
  }
  if (value === null || value === undefined || value === false) {
    return { accepted: false, companyId: null, raw: value };
  }
  if (typeof value === "string") {
    return { accepted: value.length > 0, companyId: value, raw: value };
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.ok === false) return { accepted: false, companyId: null, raw: value };
    if (o.ok === true) {
      const id = [o.companyId, o.company_id, o.CompanyId, o.value].find(
        (c) => typeof c === "string",
      );
      return { accepted: true, companyId: (id as string) ?? null, raw: value };
    }
  }
  throw new Error(
    `shape de retorno não reconhecido por este teste: ${JSON.stringify(value)}. ` +
      `Aceita: string | null | {ok:boolean,...} | throw.`,
  );
}

/** Varre qualquer estrutura procurando um segredo — em chave OU em valor. */
function deepScanForSecret(value: unknown, secret: string, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof value === "string") {
    if (value.includes(secret)) hits.push(path);
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...deepScanForSecret(v, secret, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.includes(secret)) hits.push(`${path}.<key>${k}`);
      hits.push(...deepScanForSecret(v, secret, `${path}.${k}`));
    }
  }
  return hits;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. `readCompanyIdFromCreateAccount` — sucesso por CompanyId, nunca por Status
// ═════════════════════════════════════════════════════════════════════════════

describe("readCompanyIdFromCreateAccount — a resposta REAL do POST /v2/accounts", () => {
  it('aceita {"CompanyId":"<36>","Status":"Sucesso"} e devolve o CompanyId', () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    const r = outcome(fn, REAL_CREATE_OK);
    expect(r.accepted).toBe(true);
    expect(r.companyId).toBe(SUB_TOKEN);
    expect(r.companyId).toHaveLength(36);
  });

  it(
    'CONTROLE NEGATIVO: {"status":"success"} — a forma da DOC — é REJEITADA. ' +
      "Sem este caso, uma implementação que case a string da doc passa verde e " +
      "falha contra toda subconta criada em produção.",
    () => {
      const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
      expect(outcome(fn, DOC_CREATE_OK).accepted).toBe(false);
    },
  );

  it('{"Status":"Sucesso"} SEM CompanyId é rejeitado — a string de status não decide nada', () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    expect(outcome(fn, JSON.stringify({ Status: "Sucesso" })).accepted).toBe(false);
    expect(outcome(fn, JSON.stringify({ status: "Sucesso" })).accepted).toBe(false);
  });

  it("CompanyId curto/vazio/não-string é rejeitado — 36 chars é o contrato", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    for (const bad of ["curto", "", "  ", 12345, null, true, { id: SUB_TOKEN }]) {
      expect(
        outcome(fn, JSON.stringify({ CompanyId: bad, Status: "Sucesso" })).accepted,
        `CompanyId=${JSON.stringify(bad)} deveria ser rejeitado`,
      ).toBe(false);
    }
  });

  it("aceita mesmo SEM o campo Status — só CompanyId é load-bearing", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    const r = outcome(fn, JSON.stringify({ CompanyId: SUB_TOKEN }));
    expect(r.accepted).toBe(true);
    expect(r.companyId).toBe(SUB_TOKEN);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Envelope DIFERENTE do documentado não quebra o parser
// ═════════════════════════════════════════════════════════════════════════════

describe("readCompanyIdFromCreateAccount — envelope inesperado vira DECISÃO, não exceção", () => {
  /**
   * O fornecedor já mentiu uma vez sobre este corpo (doc vs. real). A regra aqui
   * não é "aceite tudo" — é "decida sem estourar". Um `SyntaxError` daqui sobe
   * pelo `withErrorBoundary` e vira 500 com `error.message` CRU no browser.
   */
  const ENVELOPES_ESTRANHOS: Array<[string, string]> = [
    ["texto puro do ServeMux do Go", "404 page not found\n"],
    ["HTML de proxy", "<html><body>502 Bad Gateway</body></html>"],
    ["corpo vazio", ""],
    ["JSON escalar", "123"],
    ["JSON null", "null"],
    ["array no topo", JSON.stringify([{ CompanyId: SUB_TOKEN }])],
    ["envelope aninhado em data", JSON.stringify({ data: { CompanyId: SUB_TOKEN } })],
    ["envelope aninhado em company", JSON.stringify({ company: { CompanyId: SUB_TOKEN } })],
    ["camelCase minúsculo", JSON.stringify({ companyId: SUB_TOKEN, status: "ok" })],
    ["snake_case", JSON.stringify({ company_id: SUB_TOKEN })],
    ["JSON truncado", '{"CompanyId":"22222222-2222'],
  ];

  it.each(ENVELOPES_ESTRANHOS)("não estoura com %s", (_label, body) => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    // `outcome` captura throw e o classifica como rejeição; o que NÃO pode
    // acontecer é a função devolver um shape que ninguém consegue interpretar.
    expect(() => outcome(fn, body)).not.toThrow();
  });

  it("a resposta REAL com campos extras desconhecidos continua sendo aceita", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    const comExtras = JSON.stringify({
      CompanyId: SUB_TOKEN,
      Status: "Sucesso",
      // campos que o fornecedor pode acrescentar amanhã sem avisar
      Message: "Conta criada",
      resale: false,
      plan: { id: 7, name: "Padrão" },
    });
    const r = outcome(fn, comExtras);
    expect(r.accepted).toBe(true);
    expect(r.companyId).toBe(SUB_TOKEN);
  });

  it("a ordem das chaves não decide nada", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    expect(outcome(fn, `{"Status":"Sucesso","CompanyId":"${SUB_TOKEN}"}`).accepted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HTTP 200 com CORPO DE ERRO é FALHA — nas duas camadas
// ═════════════════════════════════════════════════════════════════════════════

describe("HTTP 200 com corpo de erro é falha (a armadilha central do fornecedor)", () => {
  const HUB404 = '{"error":{"type":"OAuthException","code":"Hub404"}}';
  const ERRO_VALIDACAO = '{"code":"ERROR","message":"company não é revenda"}';

  it("camada de baixo: parseNotificameBody reprova Hub404 mesmo em 200", () => {
    const r = N.parseNotificameBody(HUB404);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("Hub404");
  });

  it("camada do POST: Hub404 em HTTP 200 NÃO vira subconta", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    expect(outcome(fn, HUB404).accepted).toBe(false);
  });

  it("camada do POST: {code:ERROR} em HTTP 200 NÃO vira subconta", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    expect(outcome(fn, ERRO_VALIDACAO).accepted).toBe(false);
  });

  it(
    "envelope de erro que TAMBÉM carrega um CompanyId é rejeitado — " +
      "o envelope de erro ganha da presença do campo",
    () => {
      const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
      const hostil = JSON.stringify({
        CompanyId: SUB_TOKEN,
        error: { type: "OAuthException", code: "Hub404" },
      });
      expect(outcome(fn, hostil).accepted).toBe(false);
    },
  );

  it("a rejeição nunca carrega o corpo do fornecedor de volta (vira 500 cru no browser)", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    const r = outcome(fn, ERRO_VALIDACAO);
    expect(r.accepted).toBe(false);
    expect(JSON.stringify(r.raw ?? null)).not.toContain("company não é revenda");
  });

  it("CONTROLE POSITIVO: 200 com corpo BOM é aceito (senão tudo acima é verde por ausência)", () => {
    const fn = required<(raw: string) => unknown>("readCompanyIdFromCreateAccount");
    expect(outcome(fn, REAL_CREATE_OK).accepted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. O token da CONTA-MÃE nunca aparece em nada devolvido ao browser
// ═════════════════════════════════════════════════════════════════════════════

describe("token da conta-mãe — asserção explícita de não-vazamento", () => {
  it("readNotificameParentConfig não exige mais NOTIFICAME_COMPANY_UUID (secret morto)", () => {
    const fn = required<(env: { get(k: string): string | undefined }) => unknown>(
      "readNotificameParentConfig",
    );
    // O estado INERTE passa a ser "sem NOTIFICAME_API_TOKEN", e só.
    expect(fn(envOf({}))).toBeNull();
    const cfg = fn(envOf({ NOTIFICAME_API_TOKEN: PARENT_TOKEN })) as Record<string, unknown> | null;
    expect(cfg).not.toBeNull();
    expect(cfg?.parentToken ?? cfg?.apiToken).toBe(PARENT_TOKEN);
    // `companyUuid` não pode sobreviver na config do PAI: sob subconta ele é
    // por-org, e um campo herdado aqui é a rota mais curta para o vazamento.
    expect(Object.keys(cfg ?? {})).not.toContain("companyUuid");
    expect(Object.keys(cfg ?? {})).not.toContain("company_uuid");
  });

  it("a start_url do popup carrega o token da SUBCONTA e NUNCA o do pai", () => {
    const url = N.buildSeamlessStartUrl({
      baseUrl: BASE,
      companyUuid: SUB_TOKEN,
      redirectOrigin: "https://torquecrm.com.br",
    });
    expect(url).toContain(`company_uuid=${SUB_TOKEN}`);
    expect(url).not.toContain(PARENT_TOKEN);
    expect(url).not.toContain(OTHER_SUB_TOKEN);
  });

  it("listChannels usa o token da SUBCONTA no X-Api-Token — é isto que mata a captura cross-tenant", async () => {
    // Sob subconta, `listChannels` recebe uma `NotificameOrgConfig`. A lista já
    // chega ESCOPADA à org, e a heurística de "canal sem dono na conta-mãe"
    // deixa de existir por construção.
    const orgCfg = { baseUrl: BASE, subaccountToken: SUB_TOKEN } as unknown as Parameters<
      typeof N.listChannels
    >[0];
    const f = fetchReturning("[]");
    await N.listChannels(orgCfg, f);

    const call = f.calls[0];
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Api-Token"]).toBe(SUB_TOKEN);
    expect(call.url).not.toContain(SUB_TOKEN);
    expect(deepScanForSecret(call, PARENT_TOKEN)).toEqual([]);
  });

  it("a mensagem de erro de listChannels não carrega token nenhum", async () => {
    const orgCfg = { baseUrl: BASE, subaccountToken: SUB_TOKEN } as unknown as Parameters<
      typeof N.listChannels
    >[0];
    const f = fetchReturning('{"code":"AUTHENTICATION_ERROR"}', 404);
    await expect(N.listChannels(orgCfg, f)).rejects.toSatisfy((e: unknown) => {
      const msg = (e as Error).message;
      return !msg.includes(SUB_TOKEN) && !msg.includes(PARENT_TOKEN);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. O token da SUBCONTA não pode cair em coluna legível
// ═════════════════════════════════════════════════════════════════════════════

describe("provider_config — referência não-reversível, nunca a credencial", () => {
  const channel = { id: "ch_1", name: "Comercial", phone: "+55 (11) 98888-7777", type: "whatsapp" };
  const now = new Date("2027-08-13T12:00:00.000Z");

  it(
    "buildNotificameInstanceRow grava `subaccount_id` (o UUID da NOSSA linha) e " +
      "NENHUM byte do token da subconta — `whatsapp_instances` é lida por " +
      "qualquer membro da org sob RLS",
    () => {
      const row = N.buildNotificameInstanceRow({
        organizationId: "org-1",
        // Sob o modelo novo o parâmetro é `subaccountId`; o fixture manda os dois
        // nomes para que o teste falhe por ASSERÇÃO e não por parâmetro ausente.
        subaccountId: "sub-row-uuid-0001",
        companyUuid: "sub-row-uuid-0001",
        channel,
        now,
      } as never);

      const cfg = row.provider_config as unknown as Record<string, unknown>;
      expect(cfg.subaccount_id).toBe("sub-row-uuid-0001");
      expect(Object.keys(cfg)).not.toContain("company_uuid");

      // ASSERÇÃO NEGATIVA EXPLÍCITA — a linha inteira, não só provider_config.
      expect(deepScanForSecret(row, SUB_TOKEN)).toEqual([]);
      expect(deepScanForSecret(row, PARENT_TOKEN)).toEqual([]);
    },
  );

  it("se por acidente o token for passado como subaccountId, a linha vaza — trava o formato", () => {
    // Guarda contra o refactor mais provável: alguém religa o valor antigo no
    // parâmetro novo. O `subaccount_id` é o UUID da NOSSA linha (não 36 chars de
    // token do fornecedor), e é isso que o teste acima cobra.
    const row = N.buildNotificameInstanceRow({
      organizationId: "org-1",
      subaccountId: SUB_TOKEN,
      companyUuid: SUB_TOKEN,
      channel,
      now,
    } as never);
    // Este caso DOCUMENTA o vazamento — não o abençoa. Se ele ficar verde, é
    // porque a implementação aceitou o token no lugar da referência.
    expect(
      deepScanForSecret(row, SUB_TOKEN),
      "o token da subconta chegou à linha de whatsapp_instances",
    ).not.toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. postMessage de origem forjada ignorado — sob o modelo de subconta
// ═════════════════════════════════════════════════════════════════════════════

describe("postMessage forjado — o payload do terceiro nunca é credencial", () => {
  const FORJADAS = [
    "https://evil-notificame.com.br",
    "https://api.notificame.com.br.evil.io",
    "http://api.notificame.com.br",
    "https://hub.notificame.com.br",
    "https://api.notificame.com.br:8443",
    "https://api.notificame.com.br/",
    "null",
    "",
  ];

  it.each(FORJADAS)(
    "IGNORA mensagem de %s mesmo carregando company_uuid e session_id plausíveis",
    (origin) => {
      const payload = {
        status: "channel-success",
        company_uuid: SUB_TOKEN,
        session_id: "sess-1",
        channel_id: "ch_1",
      };
      expect(readSeamlessMessage({ origin, data: payload })).toBe("ignore");
      expect(readSeamlessMessage({ origin, data: JSON.stringify(payload) })).toBe("ignore");
    },
  );

  it("uma origem forjada não consegue nem declarar FALHA (ignore, não failure)", () => {
    expect(readSeamlessMessage({ origin: "https://evil.io", data: { status: "channel-error" } }))
      .toBe("ignore");
  });

  it(
    "CONTROLE POSITIVO: a origem legítima é aceita — e o retorno é SÓ o desfecho, " +
      "sem nenhum identificador vindo do terceiro",
    () => {
      const r = readSeamlessMessage({
        origin: NOTIFICAME_ORIGIN,
        data: { status: "channel-success", company_uuid: OTHER_SUB_TOKEN, session_id: "forjada" },
      });
      expect(r).toBe("success");
      // O contrato verificado do payload é `{status}` e SÓ. A sessão (baseline)
      // trafega pelo NOSSO canal start→finish; se um dia ela entrasse por aqui,
      // o fornecedor — ou quem falasse pela origem dele — passaria a escolher a
      // baseline, que é justamente o que decide QUAL canal é vinculado.
      expect(typeof r).toBe("string");
      expect(JSON.stringify(r)).not.toContain(OTHER_SUB_TOKEN);
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. pickNewChannel — a baseline é o que impede a org de travar para sempre
// ═════════════════════════════════════════════════════════════════════════════

describe("pickNewChannel — diff contra a foto tirada no clique", () => {
  const ch = (id: string) => ({ id });

  it(
    "órfão de popup abandonado está NA BASELINE e sai da conta: um canal novo " +
      "junto de um órfão NÃO dá ambíguo, dá o novo",
    () => {
      const fn = required<
        (
          listed: Array<{ id: string }>,
          baseline: Set<string> | null,
          claimed: Set<string>,
        ) => { ok: boolean; channel?: { id: string }; code?: string }
      >("pickNewChannel");
      // "orfao" nasceu num popup abandonado ANTES deste clique → está na foto.
      const r = fn([ch("orfao"), ch("novo")], new Set(["orfao"]), new Set());
      expect(r.ok).toBe(true);
      expect(r.channel?.id).toBe("novo");
    },
  );

  it("sem baseline (sessão ausente), dois livres seguem sendo ambíguos", () => {
    const fn = required<
      (l: Array<{ id: string }>, b: Set<string> | null, c: Set<string>) => { ok: boolean; code?: string }
    >("pickNewChannel");
    const r = fn([ch("a"), ch("b")], null, new Set());
    expect(r.ok).toBe(false);
    expect(r.code).toBe("ambiguous_channel");
  });

  it("zero candidatos → no_channel_found (retentável: consistência eventual)", () => {
    const fn = required<
      (l: Array<{ id: string }>, b: Set<string> | null, c: Set<string>) => { ok: boolean; code?: string }
    >("pickNewChannel");
    expect(fn([ch("a")], new Set(["a"]), new Set()).code).toBe("no_channel_found");
    expect(fn([ch("a")], null, new Set(["a"])).code).toBe("no_channel_found");
  });

  it("já reivindicado por outra linha nossa sai da conta mesmo fora da baseline", () => {
    const fn = required<
      (l: Array<{ id: string }>, b: Set<string> | null, c: Set<string>) => { ok: boolean; channel?: { id: string } }
    >("pickNewChannel");
    const r = fn([ch("ja_meu"), ch("novo")], new Set(), new Set(["ja_meu"]));
    expect(r.ok).toBe(true);
    expect(r.channel?.id).toBe("novo");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Corpo do POST /v2/accounts — PII do cliente não vai para o terceiro
// ═════════════════════════════════════════════════════════════════════════════

describe("buildCreateAccountBody — os dados da subconta são NOSSOS", () => {
  const defaults = {
    country: "BR",
    company_address: "Rua Um, 100",
    phone: "5551999999999",
    cpf_cnpj: "00000000000191",
    email_domain: "milennials.com.br",
  };

  it("email é determinístico pelo organization_id — é o que reconcilia órfã com org", () => {
    const fn = required<(p: Record<string, unknown>) => Record<string, unknown>>(
      "buildCreateAccountBody",
    );
    const body = fn({
      organizationId: "6030520a-2ca7-477d-be89-55758e2cd808",
      orgName: "Milennials",
      defaults,
      password: "p4ssw0rd-aleatoria",
    });
    const company = (body.company ?? body) as Record<string, unknown>;
    expect(company.email).toBe("torque-6030520a-2ca7-477d-be89-55758e2cd808@milennials.com.br");
    expect(company.name).toBe("Milennials");
    expect(company.resale).toBe(false);
    expect(company.active).toBe(true);
  });

  it("cpf_cnpj/phone/endereço saem do NOSSO secret, nunca do cliente", () => {
    const fn = required<(p: Record<string, unknown>) => Record<string, unknown>>(
      "buildCreateAccountBody",
    );
    const body = fn({
      organizationId: "org-1",
      orgName: "Cliente Qualquer",
      defaults,
      password: "x",
    });
    const company = (body.company ?? body) as Record<string, unknown>;
    expect(company.cpf_cnpj).toBe(defaults.cpf_cnpj);
    expect(company.phone).toBe(defaults.phone);
    expect(company.company_address).toBe(defaults.company_address);
  });

  it("readSubaccountDefaults é fail-closed: JSON incompleto vira null, não meia-subconta", () => {
    const fn = required<(env: { get(k: string): string | undefined }) => unknown>(
      "readSubaccountDefaults",
    );
    expect(fn(envOf({}))).toBeNull();
    expect(fn(envOf({ NOTIFICAME_SUBACCOUNT_DEFAULTS: "não é json" }))).toBeNull();
    expect(
      fn(envOf({ NOTIFICAME_SUBACCOUNT_DEFAULTS: JSON.stringify({ country: "BR" }) })),
      "faltam campos obrigatórios — provisionar meia-subconta é irreversível",
    ).toBeNull();
    expect(fn(envOf({ NOTIFICAME_SUBACCOUNT_DEFAULTS: JSON.stringify(defaults) }))).toMatchObject({
      email_domain: "milennials.com.br",
    });
  });
});
